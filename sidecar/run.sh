#!/usr/bin/env bash
set -e
PORT=${PORT:-8001}
uvicorn app:app --host 127.0.0.1 --port "$PORT" --reload