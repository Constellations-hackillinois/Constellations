#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check Python 3.10+
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Install Python 3.10+ and try again."
  exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)')
PYTHON_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)')

if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]; }; then
  echo "Error: Python 3.10+ is required (found $PYTHON_VERSION)."
  exit 1
fi

echo "Using Python $PYTHON_VERSION"

# Create venv if it doesn't exist
if [ -d ".venv" ]; then
  echo "Virtual environment already exists at .venv/, skipping creation."
else
  echo "Creating virtual environment at .venv/..."
  python3 -m venv .venv
fi

# Activate venv
source .venv/bin/activate

# Upgrade pip and install deps
echo "Upgrading pip..."
pip install --upgrade pip --quiet

echo "Installing dependencies from requirements.txt..."
pip install -r requirements.txt --quiet

echo ""
echo "Setup complete!"
echo ""
echo "Environment variables required in pipeline/.env:"
echo "  GEMINI_API_KEY=..."
echo "  SUPABASE_URL=..."
echo "  SUPABASE_KEY=..."
echo ""
echo "To activate the virtual environment:"
echo "  source pipeline/.venv/bin/activate"
