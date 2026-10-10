"""Enrich ideas from classified-chunks.jsonl and publish the results to idea-updates.jsonl.

The engine owns each idea's title and summary; the enricher only publishes `conclusion`,
`pros_cons` and `competitors`, so every field has a single writer.
"""

import json
import logging
import os
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from prompts import build_analysis_prompt, build_competitors_prompt

REPO_ROOT = Path(__file__).resolve().parents[2]

logger = logging.getLogger("enricher")


class ProCon(BaseModel):
    point: str
    category: str
    severity_or_impact: Literal["High", "Medium", "Low"]


class Analysis(BaseModel):
    summary: str
    conclusion: str
    pros: list[ProCon]
    cons: list[ProCon]


class Competitor(BaseModel):
    name: str
    summary: str
    differentiator: str


class Competitors(BaseModel):
    market_landscape: str
    competitors: list[Competitor]


def publish(topic_path: Path, messages: list[dict]) -> None:
    # One O_APPEND write per call, so concurrent publishers never interleave or lose lines.
    payload = "".join(json.dumps(message, ensure_ascii=False) + "\n" for message in messages)
    fd = os.open(topic_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT)
    try:
        os.write(fd, payload.encode("utf-8"))
    finally:
        os.close(fd)


def read_new_lines(topic_path: Path, offset: int) -> tuple[list[dict], int]:
    # Only newline-terminated lines are messages; a partial last line is read on a later tick.
    with topic_path.open("rb") as source:
        source.seek(offset)
        data = source.read()
    complete = data[: data.rfind(b"\n") + 1]
    messages = [json.loads(line) for line in complete.decode("utf-8").splitlines() if line.strip()]
    return messages, offset + len(complete)


def generate(client: genai.Client, model: str, prompt: str, schema: type[BaseModel], max_retries: int, search: bool = False) -> BaseModel:
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        tools=[types.Tool(google_search=types.GoogleSearch())] if search else None,
    )
    for attempt in range(1, max_retries + 1):
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            return schema.model_validate_json(response.text)
        except Exception as error:
            logger.warning("  ! %s attempt %d/%d failed · %s: %s", schema.__name__, attempt, max_retries, type(error).__name__, error)
    raise RuntimeError(f"Gemini failed after {max_retries} attempts")


def analyze(client: genai.Client, model: str, idea_id: str, idea: dict, discussion: str, max_retries: int) -> dict:
    analysis = generate(client, model, build_analysis_prompt(idea, discussion), Analysis, max_retries)
    return {
        "id": idea_id,
        "conclusion": analysis.conclusion,
        "pros_cons": {
            "summary": analysis.summary,
            "pros": [pro.model_dump() for pro in analysis.pros],
            "cons": [con.model_dump() for con in analysis.cons],
        },
    }


def search_competitors(client: genai.Client, model: str, idea_id: str, idea: dict, max_retries: int) -> dict:
    competitors = generate(client, model, build_competitors_prompt(idea), Competitors, max_retries, search=True)
    return {"id": idea_id, "competitors": competitors.model_dump()}


def main(
    classified_chunks_path: Path,
    idea_updates_path: Path,
    model: str,
    context_words: int,
    max_parallel: int,
    poll_interval_s: float,
    max_retries: int,
    request_timeout_s: float,
) -> None:
    load_dotenv(REPO_ROOT / ".env")
    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=types.HttpOptions(timeout=int(request_timeout_s * 1000)),
    )
    logger.info("enricher started · model %s · %d parallel · poll %.1fs", model, max_parallel, poll_interval_s)
    pool = ThreadPoolExecutor(max_parallel)

    session = 0
    offset = 0
    ideas: dict[str, dict] = {}  # id → {"title", "summary", "chunks"}
    dirty: set[str] = set()  # Ideas discussed since their last analysis.
    searched: set[str] = set()  # Ideas whose competitors were requested this session.
    running: dict[Future, tuple[int, str, str]] = {}  # future → (session, task, idea id)
    while True:
        try:
            size = classified_chunks_path.stat().st_size if classified_chunks_path.exists() else 0
            if size < offset:
                # The engine truncated its topics: a new session. In-flight results of the old one are dropped.
                logger.info("topic truncated · starting a new session")
                session += 1
                offset, ideas, dirty, searched = 0, {}, set(), set()

            if size > offset:
                messages, offset = read_new_lines(classified_chunks_path, offset)
                for message in messages:
                    for update in message["ideas"]:
                        idea = ideas.setdefault(update["id"], {"chunks": []})
                        idea["title"], idea["summary"] = update["title"], update["short-summary"]
                        idea["chunks"].append(message["chunk"])
                        dirty.add(update["id"])

            for future in [future for future in running if future.done()]:
                future_session, task, idea_id = running.pop(future)
                if future_session != session:
                    continue
                try:
                    publish(idea_updates_path, [future.result()])
                    logger.info("  published %s · %s", task, idea_id)
                except Exception as error:
                    logger.error("  ✗ %s failed · %s · %s: %s", task, idea_id, type(error).__name__, error)
                    if task == "competitors":
                        searched.discard(idea_id)  # Retried the next time the idea is discussed.

            busy = {(task, idea_id) for future_session, task, idea_id in running.values() if future_session == session}
            for idea_id in sorted(dirty):
                if ("analysis", idea_id) in busy:
                    continue  # Its new chunks are analyzed together once the running call ends.
                dirty.discard(idea_id)
                idea = ideas[idea_id]
                discussion = " ".join(" ".join(idea["chunks"]).split()[-context_words:])
                logger.info("analyzing %s · %s", idea_id, idea["title"])
                running[pool.submit(analyze, client, model, idea_id, dict(idea), discussion, max_retries)] = (session, "analysis", idea_id)
                if idea_id not in searched:
                    searched.add(idea_id)
                    logger.info("searching competitors · %s", idea_id)
                    running[pool.submit(search_competitors, client, model, idea_id, dict(idea), max_retries)] = (session, "competitors", idea_id)
        except Exception as error:
            logger.error("✗ tick failed · %s: %s", type(error).__name__, error)
        time.sleep(poll_interval_s)


if __name__ == "__main__":
    config = yaml.safe_load((REPO_ROOT / "configs" / "default.yaml").read_text())
    pubsub_dir = REPO_ROOT / config["pubsub"]["dir"]
    enricher = config["enricher"]

    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("google_genai").setLevel(logging.WARNING)
    main(
        classified_chunks_path=pubsub_dir / config["pubsub"]["classified_chunks"],
        idea_updates_path=pubsub_dir / config["pubsub"]["idea_updates"],
        model=enricher["model"],
        context_words=enricher["context_words"],
        max_parallel=enricher["max_parallel"],
        poll_interval_s=enricher["poll_interval_s"],
        max_retries=enricher["max_retries"],
        request_timeout_s=enricher["request_timeout_s"],
    )
