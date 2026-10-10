"""Single-room browser recording server; appends plain transcript batches to the pubsub transcript."""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import gradium
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = yaml.safe_load((REPO_ROOT / "configs" / "default.yaml").read_text())
PUBSUB_DIR = REPO_ROOT / CONFIG["pubsub"]["dir"]
TRANSCRIPT_FILE = PUBSUB_DIR / CONFIG["pubsub"]["transcript"]
# A reset starts a new session: the transcript and every topic derived from it are cleared together.
SESSION_TOPICS = [PUBSUB_DIR / CONFIG["pubsub"][name] for name in ("idea_updates", "classified_chunks")]
LANGUAGE = CONFIG["transcriber"]["language"]
WRITE_INTERVAL_SECONDS = CONFIG["transcriber"]["write_interval_s"]
DRAIN_SECONDS = CONFIG["transcriber"]["drain_s"]
logger = logging.getLogger("uvicorn.error")
guard = asyncio.Lock()
recording_active = False


async def file_operation(function, *args, **kwargs):
    # Cancellation must not release the guard while its worker still touches the file.
    async with guard:
        task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise


def append_batch(text):
    with TRANSCRIPT_FILE.open("a", encoding="utf-8") as output:
        output.write(text + "\n")
        output.flush()


def reset_session():
    # Clear topics first: the engine discards in-flight responses once the transcript is replaced.
    for topic in SESSION_TOPICS:
        topic.write_text("", encoding="utf-8")
    temporary = TRANSCRIPT_FILE.with_suffix(".txt.tmp")
    try:
        temporary.write_text("", encoding="utf-8")
        os.replace(temporary, TRANSCRIPT_FILE)
    finally:
        temporary.unlink(missing_ok=True)


@asynccontextmanager
async def lifespan(app):
    load_dotenv(REPO_ROOT / ".env")
    app.state.api_key = os.getenv("GRADIUM_API_KEY", "").strip()
    if not app.state.api_key:
        raise RuntimeError("Set GRADIUM_API_KEY in the root .env before starting the transcriber")
    TRANSCRIPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_FILE.touch(exist_ok=True)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ready"}


@app.post("/transcript/reset")
async def reset():
    # Ownership check and replacement are atomic relative to Start and final saving.
    async with guard:
        if recording_active:
            raise HTTPException(409, "Stop recording and wait for saving before resetting the transcript")
        try:
            reset_session()
        except OSError as exc:
            logger.error("Cannot reset session: %s", exc)
            raise HTTPException(500, "Cannot reset transcript") from exc
    return {"status": "reset"}


@app.websocket("/ws/transcribe")
async def transcribe(ws: WebSocket):
    global recording_active
    await ws.accept()
    async with guard:
        if recording_active:
            await ws.send_json({"type": "error", "message": "Recording already active"})
            await ws.close(code=1008)
            return
        recording_active = True

    fragments = []
    connected = True
    failure = None
    persistence_failed = False
    stt = None
    sender = receiver = eos = None
    loop = asyncio.get_running_loop()

    async def caption(message):
        nonlocal connected
        if connected:
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=1)
            except (Exception, asyncio.CancelledError):
                connected = False
                # Main-task cancellation still needs to reach the final save.
                if asyncio.current_task().cancelling():
                    raise

    async def receive_audio():
        nonlocal connected
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                connected = False
                return
            if message.get("bytes") is not None:
                audio = message["bytes"]
                if len(audio) % 2:
                    raise RuntimeError("Audio must be mono signed 16-bit PCM at 24 kHz")
                await asyncio.wait_for(stt.send_audio(audio), timeout=5)
            elif message.get("text") is not None:
                action = json.loads(message["text"]).get("action")
                if action == "stop":
                    return
                if action == "flush":
                    await asyncio.wait_for(stt.send_flush(), timeout=5)

    async def save_batch(reason):
        nonlocal persistence_failed
        if not fragments or persistence_failed:
            return
        text = " ".join(fragments)
        # Do not retry if an append partially succeeds before failing.
        fragments.clear()
        try:
            await file_operation(append_batch, text)
        except OSError as exc:
            persistence_failed = True
            raise RuntimeError(f"Transcript persistence failed: {exc}") from exc
        logger.info("Saved %s batch (%d chars): %s", reason, len(text), text)

    try:
        stt = gradium.GradiumClient(api_key=app.state.api_key).stt_realtime(
            model_name="default", input_format="pcm",
            json_config={"language": LANGUAGE}, wait_for_ready_on_start=True,
        )
        await asyncio.wait_for(stt.__aenter__(), timeout=10)
        await caption({"type": "ready"})
        sender = asyncio.create_task(receive_audio())
        receiver = asyncio.create_task(stt.recv())
        next_write = loop.time() + WRITE_INTERVAL_SECONDS
        drain_deadline = None
        while True:
            if drain_deadline is None and (sender.done() or not connected):
                if sender.done():
                    sender.result()
                else:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
                drain_deadline = loop.time() + DRAIN_SECONDS
                eos = asyncio.create_task(stt.send_eos())
            deadline = min(next_write, drain_deadline or float("inf"))
            tasks = {receiver}
            if drain_deadline is None:
                tasks.add(sender)
            if eos is not None:
                tasks.add(eos)
            done, _ = await asyncio.wait(tasks, timeout=max(0, deadline - loop.time()),
                                         return_when=asyncio.FIRST_COMPLETED)
            if eos in done:
                eos.result()
                eos = None
            if receiver in done:
                message = receiver.result()
                if message is None or message.get("type") == "end_of_stream":
                    break
                if message.get("type") == "error":
                    raise RuntimeError(f"Gradium: {message.get('message', message)}")
                if message.get("type") == "text":
                    text = " ".join(message.get("text", "").split())
                    if text:
                        fragments.append(text)
                        await caption({"type": "transcript", "text": text,
                                       "timestamp": datetime.now().strftime("%H:%M:%S")})
                receiver = asyncio.create_task(stt.recv())
            if loop.time() >= next_write:
                await save_batch("periodic")
                # Advance to the next future deadline, without catch-up writes.
                next_write += (int((loop.time() - next_write) / WRITE_INTERVAL_SECONDS) + 1) * WRITE_INTERVAL_SECONDS
            if drain_deadline is not None and loop.time() >= drain_deadline:
                raise RuntimeError("Gradium shutdown timed out; received text was saved, but final results may be incomplete")
    except asyncio.CancelledError:
        failure = "Recording interrupted by server shutdown"
        raise
    except Exception as exc:
        failure = str(exc)
        logger.error("Recording failed: %s", failure)
    finally:
        tasks = [task for task in (sender, receiver, eos) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await save_batch("final")
        except Exception as exc:
            failure = str(exc)
            logger.error("Final save failed: %s", failure)
        if stt is not None:
            try:
                # __aenter__ can fail after opening the SDK's HTTP session.
                await asyncio.wait_for(stt.__aexit__(None, None, None), timeout=2)
            except Exception as exc:
                failure = failure or f"Gradium connection cleanup failed: {exc}"
                logger.error("%s", failure)
        async with guard:
            recording_active = False
        if failure:
            await caption({"type": "error", "message": failure})
        if connected:
            try:
                await ws.close(code=1011 if failure else 1000)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_graceful_shutdown=10)
