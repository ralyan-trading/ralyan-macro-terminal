#!/usr/bin/env bash
# Daily refresh for any always-on Linux machine / VPS / Raspberry Pi:
#   crontab -e  ->  23 6 * * * /path/to/macro_terminal/run_daily.sh >> /path/to/macro_terminal/build.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
mkdir -p publish && cp index.html publish/index.html   # serve ./publish with any static web server
