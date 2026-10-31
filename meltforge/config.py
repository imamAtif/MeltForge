"""
MeltForge Configuration Settings.
"""

from pathlib import Path
import os

PROJECT_ROOT = Path(os.environ.get("MELTANO_PROJECT_ROOT", Path.cwd())).resolve()
STATIC_DIR = Path(__file__).parent / "static"
API_VERSION = "0.1.0"
APP_NAME = "MeltForge"
