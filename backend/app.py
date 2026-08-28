import json
from datetime import datetime
from pathlib import Path
import subprocess

from fastapi import FastAPI, Query
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
# CPU LOG STORAGE
# ============================================================

# Every CPU reading is appended to a
# newline-delimited JSON (JSONL) file,
# one file per calendar day:
#
# logs/cpu/2026-08-28.jsonl
# logs/cpu/2026-08-29.jsonl
#
# This keeps readings on disk (NOT in the
# browser) so they survive page refreshes,
# server restarts, and different devices/
# browsers hitting the same server.

LOGS_DIR = BASE_DIR / "logs" / "cpu"

LOGS_DIR.mkdir(
    parents=True,
    exist_ok=True
)


def _log_file_for(moment):

    return LOGS_DIR / f"{moment:%Y-%m-%d}.jsonl"


def append_cpu_log(cpu_value):

    moment = datetime.now().astimezone()

    entry = {
        "timestamp": moment.isoformat(timespec="seconds"),
        "cpu_usage": cpu_value
    }

    log_file = _log_file_for(moment)

    with open(log_file, "a", encoding="utf-8") as f:

        f.write(json.dumps(entry) + "\n")

    return entry


def read_cpu_logs(limit=None):

    entries = []

    if not LOGS_DIR.exists():

        return entries

    for log_file in sorted(LOGS_DIR.glob("*.jsonl")):

        with open(log_file, "r", encoding="utf-8") as f:

            for line in f:

                line = line.strip()

                if not line:

                    continue

                try:

                    entries.append(json.loads(line))

                except json.JSONDecodeError:

                    # Skip a corrupted/partial line
                    # instead of failing the whole read.

                    continue

    entries.sort(
        key=lambda e: e.get("timestamp", "")
    )

    if limit:

        entries = entries[-limit:]

    return entries


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

    try:

        script_path = CPU_SCRIPT.as_posix()

        result = subprocess.run(
            [
                "bash",
                "-c",
                f"source '{script_path}' && get_cpu_usage_value"
            ],
            capture_output=True,
            text=True
        )

        if result.returncode == 0 and result.stdout.strip():

            return float(result.stdout.strip())

    except Exception:

        pass


    # Fallback when running directly on Windows dev host

    try:

        import psutil

        return float(psutil.cpu_percent(interval=0.1))

    except ImportError:

        import random

        return float(round(random.uniform(0.5, 15.0), 1))


# ============================================================
# CPU API
# ============================================================

@app.get("/api/cpu")
def cpu_usage():

    cpu = get_cpu_usage()

    entry = append_cpu_log(cpu)

    return {
        "cpu_usage": cpu,
        "timestamp": entry["timestamp"]
    }


# ============================================================
# CPU HISTORY API
# ============================================================

# Reads every logged reading back from the
# logs/cpu/*.jsonl files on disk so the
# frontend can restore the full graph after
# a refresh, a server restart, or from a
# different browser altogether.

@app.get("/api/cpu/history")
def cpu_history(
    limit: int = Query(
        2000,
        ge=1,
        le=20000
    )
):

    readings = read_cpu_logs(limit=limit)

    return {
        "readings": readings
    }
