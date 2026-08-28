from pathlib import Path
import subprocess

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="Enterprise Linux Server Management Platform"
)


# ============================================================
# PROJECT PATHS
# ============================================================

# /home/ubuntu/elsmp-poc/backend/app.py
#                       ↑
#                       |
# BASE_DIR = /home/ubuntu/elsmp-poc

BASE_DIR = Path(__file__).resolve().parent.parent

MODULES_DIR = BASE_DIR / "modules"

CPU_SCRIPT = MODULES_DIR / "system_health.sh"

FRONTEND_DIR = BASE_DIR / "frontend"

FRONTEND_FILE = FRONTEND_DIR / "index.html"

STATIC_DIR = FRONTEND_DIR / "static"


# ============================================================
# SERVE STATIC FILES
# ============================================================

# Browser:
#
# /static/style.css
#       ↓
# frontend/static/style.css
#
# /static/script.js
#       ↓
# frontend/static/script.js

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static"
)


# ============================================================
# SERVE FRONTEND
# ============================================================

@app.get("/")
def home():

    return FileResponse(FRONTEND_FILE)


# ============================================================
# GET CPU USAGE FROM BASH MODULE
# ============================================================

def get_cpu_usage():

    result = subprocess.run(
        [
            "bash",
            "-c",
            f"source '{CPU_SCRIPT}' && get_cpu_usage_value"
        ],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:

        raise RuntimeError(
            result.stderr.strip()
            or "Failed to get CPU usage"
        )

    output = result.stdout.strip()

    try:

        return float(output)

    except ValueError:

        raise RuntimeError(
            f"Invalid CPU value returned by Bash: {output}"
        )


# ============================================================
# CPU API
# ============================================================

@app.get("/api/cpu")
def cpu_usage():

    cpu = get_cpu_usage()

    return {
        "cpu_usage": cpu
    }
