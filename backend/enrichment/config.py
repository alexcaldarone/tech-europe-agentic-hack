import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

# Paths
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
IDEAS_FILE = DATA_DIR / "ideas.json"
TRANSCRIPT_FILE = DATA_DIR / "transcript.txt"
IDEA_ARTIFACTS_DIR = DATA_DIR / "ideas"

# Keep local development predictable: `cp .env.example .env` works whether
# uvicorn is launched from the repository root or this service directory.
load_dotenv(PROJECT_ROOT / ".env")

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# Non-secret settings live in configs/default.yaml.
_config = yaml.safe_load((PROJECT_ROOT / "configs" / "default.yaml").read_text())["enrichment"]

# LLM Configurations
DEFAULT_PROVIDER = _config["default_provider"]  # "gemini", "openai", "auto", "mock"
GEMINI_MODEL = _config["model"]
GEMINI_FAST_MODEL = _config["fast_model"]
GROUNDED_SEARCH_TIMEOUT_SECONDS = float(_config["grounded_search_timeout_s"])
OPENAI_MODEL = _config["openai_model"]
LLM_TIMEOUT_SECONDS = float(_config["llm_timeout_s"])

# Microservice Server Config
SERVER_HOST = _config["host"]
SERVER_PORT = int(_config["port"])
