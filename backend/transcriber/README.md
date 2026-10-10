# Browser recording server

The microphone lives in the browser. This single-file FastAPI service streams incoming 24 kHz mono signed 16-bit PCM to Gradium and appends plain text to `pubsub/transcript.txt`.

Set `GRADIUM_API_KEY` in the root `.env`; other settings are under `transcriber` in `configs/default.yaml`. From this directory:

```bash
uv run python main.py
```

The service listens on port 8000 with **one worker**. Use the frontend's Start, Stop, and Reset transcript buttons; terminal microphone and Space controls are no longer needed. For the complete four-service prototype, follow the root README and run `docker compose up --build`.

| Interface | Behavior |
| --- | --- |
| WebSocket `/ws/transcribe` | Start: claim the single recording slot, connect Gradium, send `{"type":"ready"}`, then accept binary PCM. A second recorder receives an error. |
| Socket `{"action":"stop"}` | Send end-of-stream once, drain for up to five seconds, save remaining text, close normally. Disconnects also drain and save. |
| Socket `{"action":"flush"}` | Request a provider flush; file writes still follow the timer. |
| `GET /transcript` | `{"transcript":"..."}` containing only persisted text. |
| `POST /transcript/reset` | Start a new session: clear `idea-updates.jsonl` and `classified-chunks.jsonl`, then atomically replace the transcript with an empty file. Return 409 during recording initialization, capture, or final saving. |
| `GET /health` | Local readiness without contacting Gradium. |

Live captions use `{"type":"transcript","text":"...","timestamp":"HH:MM:SS"}`. Failures use `{"type":"error","message":"..."}` and an abnormal close. A normal close confirms the final save. Provider shutdown timeout is reported as incomplete transcription; already received text is saved.

`transcriber.write_interval_s` controls batching. Each nonempty batch appends one normalized line without a timestamp. Silence writes nothing. Start and service startup preserve existing contents; only Reset clears them. Read endpoints coordinate with writes. Direct file consumers must wait for a terminating newline before consuming an entry.

A failed file append terminates recording and is not retried because it may have partially succeeded. Pending text is in memory and cannot survive a forced process kill. Run only one transcriber process against the file.
