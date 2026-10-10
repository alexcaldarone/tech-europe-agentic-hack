# Brainy Storm

A local brainstorming prototype: browser microphone → Gradium transcription → shared transcript → Gemini ideas → React idea board.

## Run with Docker

Install and start Docker Desktop, then configure your keys in the repository root:

### Collaborators

```bash
cp .env.example .env
# Edit .env: set GRADIUM_API_KEY and GEMINI_API_KEY.
docker compose up --build
```

Open **http://localhost:5173** and allow microphone access. `.env` holds secrets only; every other setting (models, chunk size, intervals, topic paths) lives in `configs/default.yaml`.

- **Start** captures your browser microphone and appends to the existing transcript.
- **Stop** releases the microphone, receives final Gradium results for up to five seconds, and saves remaining text. Wait for **Saving…** to finish before starting again.
- **Reset transcript** starts a new session while stopped: it clears the transcript, every pubsub topic and all ideas on the board.
- **Export transcript** downloads the persisted plain text, including all completed batches.

Only one recording can run at a time. Everyone using the prototype shares one room; the sidebar's other brainstorms are still UI examples. Speech is labelled **Room**; speaker identification is not included.

## Services and files

Compose runs four containers: Vite/React, the single-worker Python transcriber, the Python engine, and the existing Node enrichment API. Only the frontend is published, at `127.0.0.1:5173`.

The frontend uses Vite for the hackathon demo and mounts `./frontend`, so source edits reload immediately. Container dependencies live in their own volume, separate from your Mac/Linux `node_modules`. Startup runs `npm ci` against the current lockfile so a teammate's dependency changes are picked up after restarting the frontend. Backend source changes require `docker compose up --build` again.

Services communicate only through files in `./pubsub`, mounted at `/app/pubsub` (see `GIACOMO-AGENTS.md`):

- `transcript.txt`: written by the transcriber, one plain-text line per nonempty batch, plus the final partial batch on Stop. Readers consume only newline-terminated lines.
- `idea-updates.jsonl`: written by the engine (and, later, enrichment); the frontend folds it by idea `id` to build the board.
- `classified-chunks.jsonl`: written by the engine for enrichment.

One transcript is one session. The engine starts a new session at startup and whenever the transcript is replaced: it truncates its topics, forgets its in-memory ideas and discards in-flight Gemini responses. On restart it rereads the retained transcript and regenerates the ideas.

The browser reads `idea-updates.jsonl` through the Vite dev server at `/api/pubsub/idea-updates.jsonl`. Node enrichment endpoints are available under `/api/enrichment/idea/*`, but enrichment does not yet subscribe to `classified-chunks.jsonl`. The alternative Python enrichment API is not part of Compose. Both still use `./data`.

Containers do not access the host microphone. The browser sends 24 kHz mono signed 16-bit PCM. Localhost supports microphone access; a remote deployment would need HTTPS and appropriate access control.

## Operations

```bash
docker compose logs -f transcriber engine enricher
docker compose ps
docker compose down
```

Stop recording before shutting down when possible. Attached Compose also stops with Ctrl+C; the transcriber has time to save received text. `docker compose down` leaves `./data` intact. A forced kill cannot recover text still held in memory.

Health checks are local and do not call external providers:

```bash
curl http://localhost:5173/api/transcriber/health
curl http://localhost:5173/api/enrichment/health
```

Keep real keys in `.env`; they are passed only to the appropriate backend containers and excluded from image builds. Do not run another stack or local service against the same `pubsub/` files concurrently.

## Local development

Use Python 3.13 with `uv`, and Node 22. In separate terminals, from the indicated folders:

```bash
# backend/transcriber (loads the root .env)
uv run python main.py

# backend/engine (loads the root .env)
uv run python main.py

# backend/enrichment
npm ci
node --import tsx server.ts  # loads the root .env

# frontend
npm ci
npm run dev
```

Open http://localhost:5173. The same Vite configuration handles Docker and local development:

| Browser route | Internal destination |
| --- | --- |
| `/api/transcriber/*` | transcriber `/*`, port 8000, including WebSockets |
| `/api/enrichment/*` | Node enrichment `/api/*`, port 3000 |

Compose sets `TRANSCRIBER_TARGET` and `ENRICHMENT_TARGET` to Docker service names; local Vite defaults to localhost. Optional browser API-base overrides are `VITE_TRANSCRIBER_URL` and `VITE_ENRICHMENT_URL`; the default proxy routes need no frontend environment file.

## Check the prototype

```bash
cd frontend
npm run build
npm run lint
# From the repository root, with .env configured:
docker compose config --quiet
docker compose build
```

For a smoke test, Start and speak for roughly twelve seconds. Check immediate captions and transcript lines near five and ten seconds, then Stop and check the final line. Wait for generated ideas. Start and Stop again to confirm appending, then Reset to confirm ideas stay. Restart the containers to confirm retained data remains.
