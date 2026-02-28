"""Load environment variables from the project root .env file."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one level up from pipeline/)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPERMEMORY_API_KEY = os.environ.get("SUPERMEMORY_API_KEY", "")
SUPERMEMORY_CONTAINER_TAG = os.environ.get("SUPERMEMORY_CONTAINER_TAG", "sm_project_constellations")

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
PDF_CACHE = CACHE_DIR / "pdfs"
DENSIFIED_CACHE = CACHE_DIR / "densified"

# Ensure cache dirs exist
PDF_CACHE.mkdir(parents=True, exist_ok=True)
DENSIFIED_CACHE.mkdir(parents=True, exist_ok=True)
