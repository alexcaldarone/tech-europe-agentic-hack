import json
import logging
import os
import sys
import time
from pathlib import Path

import yaml
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from prompt import build_prompt


REPO_ROOT = Path(__file__).resolve().parents[2]

logger = logging.getLogger("engine")


class LevelColorFormatter(logging.Formatter):
    COLORS = {logging.WARNING: "\033[33m", logging.ERROR: "\033[31m"}
    DIM = "\033[2m"
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, "%H:%M:%S")
        color = self.COLORS.get(record.levelno, "")
        return f"{self.DIM}{timestamp}{self.RESET}  {color}{record.getMessage()}{self.RESET}"


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(LevelColorFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    # Silence per-request lines from the HTTP client and the Gemini SDK.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("google_genai").setLevel(logging.WARNING)


def plural(count: int, noun: str) -> str:
    return f"{count:,} {noun}" if count == 1 else f"{count:,} {noun}s"


class IdeaUpdate(BaseModel):
    id: str | None
    title: str
    summary: str
    is_currently_discussed: bool = False


class ChunkIdeas(BaseModel):
    ideas: list[IdeaUpdate]


def reset_topic(topic_path: Path) -> None:
    topic_path.parent.mkdir(parents=True, exist_ok=True)
    topic_path.write_text("")


def publish(topic_path: Path, messages: list[dict]) -> None:
    # One O_APPEND write per call, so concurrent publishers never interleave or lose lines.
    payload = "".join(json.dumps(message, ensure_ascii=False) + "\n" for message in messages)
    fd = os.open(topic_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT)
    try:
        os.write(fd, payload.encode("utf-8"))
    finally:
        os.close(fd)


def file_identity(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino


def read_transcript(path: Path) -> tuple[tuple[int, int], str]:
    # Read identity from the open file so a concurrent reset cannot mix generations.
    with path.open(encoding="utf-8", errors="replace") as source:
        stat = os.fstat(source.fileno())
        text = source.read()
    # The transcriber appends whole lines; wait for the trailing newline.
    return (stat.st_dev, stat.st_ino), text[:text.rfind("\n") + 1]


def to_message(idea_id: str, idea: dict) -> dict:
    return {
        "id": idea_id,
        "title": idea["title"],
        "short-summary": idea["summary"],
        "is-currently-discussed": idea["is_currently_discussed"],
    }


def trailing_context(processed: str, context_words: int) -> str:
    # The words right before the new text, so short chunks are read in context.
    words = processed.split()
    return " ".join(words[-context_words:]) if context_words > 0 else ""


def extract_ideas(
    client: genai.Client,
    model: str,
    ideas: dict[str, dict],
    context: str,
    chunk: str,
    max_retries: int,
) -> list[IdeaUpdate]:
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=ChunkIdeas,
    )
    prompt = build_prompt(ideas, context, chunk)
    logger.info("  → request · %s · %s", plural(len(ideas), "known idea"), plural(len(prompt), "prompt char"))

    start = time.monotonic()
    for attempt in range(1, max_retries + 1):
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            updates = ChunkIdeas.model_validate_json(response.text).ideas
            logger.info("  ← response · %.1fs · %s", time.monotonic() - start, plural(len(updates), "idea"))
            return updates
        except Exception as error:
            logger.warning("  ! attempt %d/%d failed · %s: %s", attempt, max_retries, type(error).__name__, error)
    raise RuntimeError(f"Gemini failed after {max_retries} attempts")


def merge_ideas(ideas: dict[str, dict], updates: list[IdeaUpdate]) -> tuple[dict[str, dict], list[str]]:
    """Return the merged ideas and the ids discussed in the chunk. At most one idea keeps the focus."""
    merged = dict(ideas)
    touched_ids = []
    focus_id = None

    for update in updates:
        if update.id in merged:
            idea_id = update.id
            logger.info("  ~ %s %s", idea_id, update.title)
        else:
            # Unknown ids are treated as new ideas.
            idea_id = f"idea-{len(merged) + 1}"
            logger.info("  + %s %s", idea_id, update.title)
        merged[idea_id] = {"title": update.title, "summary": update.summary}
        if update.is_currently_discussed:
            focus_id = idea_id
        if idea_id not in touched_ids:
            touched_ids.append(idea_id)

    for idea_id, idea in merged.items():
        merged[idea_id] = {**idea, "is_currently_discussed": idea_id == focus_id}
    return merged, touched_ids


def replace_transcript(transcript_path: Path, text: str) -> None:
    # Atomic replace, like a transcriber reset: readers see a new file and start a new session.
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = transcript_path.with_name(transcript_path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, transcript_path)


def main(
    transcript_path: Path,
    idea_updates_path: Path,
    classified_chunks_path: Path,
    model: str,
    chunk_words: int,
    context_words: int,
    idle_flush_s: float,
    poll_interval_s: float,
    max_retries: int,
    request_timeout_s: float,
) -> None:
    load_dotenv(REPO_ROOT / ".env")
    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(timeout=int(request_timeout_s * 1000)),
    )
    logger.info(
        "engine started · model %s · every %d words · %d-word window · idle flush %gs · poll %.1fs · retries %d · timeout %gs",
        model, chunk_words, context_words, idle_flush_s, poll_interval_s, max_retries, request_timeout_s,
    )
    # Each run starts a fresh session from an empty transcript.
    replace_transcript(transcript_path, "")

    ideas: dict[str, dict] = {}
    offset = 0
    identity = None
    previous_length = 0
    last_text_at = time.monotonic()
    chunk_number = 1
    last_waiting_words = None
    while True:
        try:
            current_identity, transcript = read_transcript(transcript_path)
            if current_identity != identity or len(transcript) < offset:
                # First tick, or the transcript was reset: one transcript is one session, so start fresh.
                # Subscribers see the topics shrink and reset themselves.
                logger.info("new transcript · starting a new session")
                for topic_path in (idea_updates_path, classified_chunks_path):
                    reset_topic(topic_path)
                identity = current_identity
                ideas, offset, previous_length, chunk_number = {}, 0, 0, 1
                last_text_at = time.monotonic()
            if len(transcript) != previous_length:
                previous_length = len(transcript)
                last_text_at = time.monotonic()
            # Send every pending word at once, so the engine catches up after a slow call.
            chunk = transcript[offset:]
            new_words = len(chunk.split())
            if new_words < chunk_words and not (new_words and time.monotonic() - last_text_at >= idle_flush_s):
                # Log only when the pending count changes, to keep idle ticks quiet.
                if new_words != last_waiting_words:
                    logger.info("waiting · %d/%d new words", new_words, chunk_words)
                    last_waiting_words = new_words
                time.sleep(poll_interval_s)
                continue
            last_waiting_words = None
            # The prompt holds a trailing window of context_words: the new words plus the ones before them.
            context = trailing_context(transcript[:offset], context_words - new_words)

            logger.info(
                "chunk #%d · %s + %s of context · offset %s → %s",
                chunk_number, plural(new_words, "new word"), plural(len(context.split()), "word"),
                f"{offset:,}", f"{offset + len(chunk):,}",
            )
            updates = extract_ideas(client, model, ideas, context, chunk, max_retries)
            if file_identity(transcript_path) != identity:
                logger.info("  discarded response · transcript was reset during the call")
                continue
            merged_ideas, touched_ids = merge_ideas(ideas, updates)
            # Ideas that lost the focus without being discussed are republished so the topic stays consistent.
            refocused_ids = [
                idea_id for idea_id in ideas
                if idea_id not in touched_ids
                and merged_ideas[idea_id]["is_currently_discussed"] != ideas[idea_id]["is_currently_discussed"]
            ]

            # Publish idea updates first, so the frontend knows an idea before enrichment does.
            publish(idea_updates_path, [to_message(idea_id, merged_ideas[idea_id]) for idea_id in touched_ids + refocused_ids])
            publish(
                classified_chunks_path,
                [{"chunk": chunk, "ideas": [to_message(idea_id, merged_ideas[idea_id]) for idea_id in touched_ids]}],
            )
            logger.info("  published · %s touched · %s total", plural(len(touched_ids), "idea"), plural(len(merged_ideas), "idea"))

            ideas = merged_ideas
            offset += len(chunk)
            chunk_number += 1
        except Exception as error:
            logger.error("  ✗ tick failed, retrying chunk #%d next tick · %s: %s", chunk_number, type(error).__name__, error)
            time.sleep(poll_interval_s)


if __name__ == "__main__":
    config = yaml.safe_load((REPO_ROOT / "configs" / "default.yaml").read_text())
    pubsub_dir = REPO_ROOT / config["pubsub"]["dir"]
    engine = config["engine"]

    setup_logging()
    main(
        transcript_path=pubsub_dir / config["pubsub"]["transcript"],
        idea_updates_path=pubsub_dir / config["pubsub"]["idea_updates"],
        classified_chunks_path=pubsub_dir / config["pubsub"]["classified_chunks"],
        model=engine["model"],
        chunk_words=engine["chunk_words"],
        context_words=engine["context_words"],
        idle_flush_s=engine["idle_flush_s"],
        poll_interval_s=engine["poll_interval_s"],
        max_retries=engine["max_retries"],
        request_timeout_s=engine["request_timeout_s"],
    )
