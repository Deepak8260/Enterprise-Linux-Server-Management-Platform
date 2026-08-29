# Enterprise Linux Server Management Platform

A lightweight, self-hosted platform for monitoring and managing Linux servers, combining a native Bash CLI with a FastAPI backend and a browser-based dashboard for real-time system observability.

## Overview

The platform is built around a simple principle: system data is collected using standard Linux tools (`top`, `/proc`, etc.) through a Bash module, exposed over HTTP by a FastAPI backend, and visualized in a modern web dashboard. Readings are persisted to disk as newline-delimited JSON (JSONL) logs, so historical data survives page refreshes, browser changes, and server restarts.

The project ships in two complementary forms:

- **CLI mode** — an interactive, menu-driven Bash script for operating directly on the server over SSH or a local terminal.
- **Web dashboard** — a FastAPI + vanilla JS/HTML/CSS frontend that polls live metrics, renders them on interactive charts, and lets you filter by time range or historical date range.

## Features

### System Health — CPU Usage (implemented)

- Real-time CPU utilization polling with a configurable refresh interval (1s / 5s / 10s / 30s / 1 min).
- Live chart with pause/resume control and a custom scrollbar/scrubber for scrubbing through the visible window.
- **Time Range filter** — Live, Last 1 Hour, Last 5 Hours, Last 12 Hours, or a custom time-of-day range.
- **Date Range filter** — Last 1 Day, Last 3 Days, Last 5 Days, or a custom date-and-time range, picked from a dual interactive calendar with 12-hour time inputs.
- Automatic chart data aggregation/downsampling for wide date ranges, while KPI statistics always compute from full-resolution raw data.
- KPI tiles: Current/Average (context-aware — see below), Peak (with timestamp), Minimum (with timestamp), and total Readings.
- An applied range summary bar showing the exact selected window and its computed duration.
- The hero "CPU Utilization" figure adapts to context: it shows the live latest reading in Live mode, and automatically relabels to show the **Average** for the selected range whenever a Time Range or Date Range filter is applied.

### Other modules (CLI scaffold, planned for the web dashboard)

The CLI menu already scaffolds the following management areas; the web UI will expose these progressively:

- User & Group Management
- Service Management
- Process Manager
- Storage & Filesystem
- Log Analyzer
- Security Audit
- Backup Manager
- Report Generator

## Architecture

```
main.sh                  Interactive Bash CLI entry point
modules/
  system_health.sh       Shell functions for collecting live system metrics
backend/
  app.py                 FastAPI server: serves the frontend and exposes the metrics API
frontend/
  index.html             Dashboard shell and page templates
  static/style.css        Design system and layout styling
  static/script.js         Dashboard logic, charts, filters, state management
logs/
  cpu/YYYY-MM-DD.jsonl    Daily CPU reading logs (one JSON object per line)
```

### How it fits together

1. `modules/system_health.sh` reads live CPU utilization from the OS (via `top`).
2. `backend/app.py` invokes that script through a subprocess, appends each reading to a daily JSONL log under `logs/cpu/`, and serves it to the browser through a small REST API.
3. `frontend/static/script.js` polls the API on an interval, maintains the full reading history in memory, and derives everything the UI shows — the live chart, KPI tiles, and range summary — from whichever Time Range / Date Range filter is currently selected.

## API Reference

| Method | Endpoint            | Description                                                            |
|--------|----------------------|--------------------------------------------------------------------------|
| GET    | `/`                  | Serves the dashboard frontend                                            |
| GET    | `/api/cpu`           | Returns the current CPU usage reading and logs it to disk                |
| GET    | `/api/cpu/history`   | Returns historical CPU readings (optionally limited with `?limit=`)      |

## Requirements

- Linux (or WSL on Windows) — metrics collection relies on standard Linux CLI tools.
- Python 3.10+
- Dependencies (see `requirements.txt`): `fastapi`, `uvicorn`, `psutil`

## Getting Started

### 1. Clone and set up a virtual environment

```bash
git clone git@github-personal:Deepak8260/Enterprise-Linux-Server-Management-Platform.git
cd Enterprise-Linux-Server-Management-Platform

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Run the web dashboard

```bash
source venv/bin/activate
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000` in your browser.

### 3. Run the CLI (optional)

```bash
chmod +x main.sh
./main.sh
```

## Notes for WSL users

If you're running this inside WSL, make sure the virtual environment is created and activated from within the WSL shell (not a Windows-side Python), and that `main.sh` is executed from the WSL filesystem to avoid line-ending and permission issues on scripts sourced from a Windows-mounted drive.

## Project Status

This is an active proof-of-concept. CPU Usage monitoring under System Health is fully functional end-to-end (live + historical filtering, aggregation, KPIs). The remaining management modules are scaffolded in the CLI and are being brought online in the web dashboard incrementally.

## License

Add your preferred license here (e.g., MIT) before making this repository public.
