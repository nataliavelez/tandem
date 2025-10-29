#!/usr/bin/env bash
set -euo pipefail

# Ensure the conda shell functions are available in non-interactive scripts
eval "$(conda shell.bash hook)"
conda activate tandem

# Prevent picking up user-site packages from base
export PYTHONNOUSERSITE=1

echo "Using Python: $(python -c 'import sys; print(sys.executable)')"
python - <<'PY'
import sys
print("python:", sys.version)
try:
    import jax, jaxlib, flax
    print("jax:", jax.__version__)
    print("jaxlib:", jaxlib.__version__)
    print("flax:", flax.__version__)
except Exception as e:
    print("Version check failed:", e)
PY

# Prefer no-reload first to eliminate reloader mismatches; add --reload later if needed
exec python -m uvicorn app:app --host 127.0.0.1 --port 8001

