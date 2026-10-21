# Shared by deploy/setup.sh and deploy/update.sh (sourced, not run).
# Fixed layout on the server:
#   /opt/tandem/app      this repo (jaxmarl cloned inside it at the pinned commit)
#   /opt/tandem/venv     Python environment for the sidecar
#   /opt/tandem/python   the Python interpreter uv installed
#   /opt/tandem/data     data logs (DATA_DIR)
#   /etc/tandem/         tandem.env (server settings + secrets), deploy.env (domain, git ref)

APP_USER=tandem
BASE=/opt/tandem
APP=$BASE/app
VENV=$BASE/venv
DATA=$BASE/data
ETC=/etc/tandem
export UV_PYTHON_INSTALL_DIR=$BASE/python

log() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }
as_app() { sudo -u "$APP_USER" -H env UV_PYTHON_INSTALL_DIR="$UV_PYTHON_INSTALL_DIR" "$@"; }

require_root() {
  [ "$(id -u)" -eq 0 ] || { echo "Run this as root: sudo bash $0" >&2; exit 1; }
}

# Check out GIT_REF (branch, tag or commit) in $APP, fast-forwarding a branch to origin.
checkout_ref() {
  local ref="$1"
  as_app git -C "$APP" fetch --prune --tags origin
  if as_app git -C "$APP" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
    as_app git -C "$APP" checkout -B "$ref" "origin/$ref"
  else
    as_app git -C "$APP" checkout --detach "$ref"
  fi
  log "Code at $(as_app git -C "$APP" rev-parse --short HEAD) ($ref)"
}

# Python env, pinned jaxmarl, Node deps, client build. Safe to re-run.
build_app() {
  local domain="$1"
  # shellcheck source=deploy/versions.env
  . "$APP/deploy/versions.env"

  log "Sidecar Python $PYTHON_VERSION environment"
  [ -x "$VENV/bin/python" ] || as_app uv venv --python "$PYTHON_VERSION" "$VENV"
  as_app uv pip install --python "$VENV/bin/python" -r "$APP/sidecar/requirements-lock.txt"

  log "JaxMARL at $JAXMARL_COMMIT"
  [ -d "$APP/jaxmarl/.git" ] || as_app git clone "$JAXMARL_REPO" "$APP/jaxmarl"
  as_app git -C "$APP/jaxmarl" fetch origin
  as_app git -C "$APP/jaxmarl" checkout --detach "$JAXMARL_COMMIT"
  as_app uv pip install --python "$VENV/bin/python" --no-deps -e "$APP/jaxmarl"

  log "Server dependencies"
  as_app bash -c "cd '$APP/server' && npm ci --no-audit --no-fund"

  log "Client build (connects to wss://$domain/ws)"
  as_app bash -c "cd '$APP/client' && npm ci --no-audit --no-fund && VITE_SERVER_URL='wss://$domain/ws' npm run build"

  # npm ci also rewrites the yarn.lock files; restore them so the data logs
  # don't record the deployed code as modified (study.code.dirty)
  as_app git -C "$APP" checkout -- client/yarn.lock server/yarn.lock 2>/dev/null || true
  if [ -n "$(as_app git -C "$APP" status --porcelain)" ]; then
    warn "The deployed code differs from its commit (data logs will say code.dirty=true):"
    as_app git -C "$APP" status --short >&2
  fi
}

# Wait until the sidecar answers and the game server has warmed it up.
wait_healthy() {
  local since="$1"
  log "Waiting for the sidecar and game server"
  for _ in $(seq 1 90); do
    curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1 && break
    sleep 2
  done
  curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1 || { warn "Sidecar not answering; see: journalctl -u tandem-sidecar -n 50"; return 1; }
  for _ in $(seq 1 60); do
    journalctl -u tandem-server --since "$since" --no-pager 2>/dev/null | grep -q "sidecar warmed up" && { echo "sidecar and game server are up"; return 0; }
    systemctl is-active --quiet tandem-server || break
    sleep 2
  done
  warn "Game server not ready; see: journalctl -u tandem-server -n 50"
  return 1
}

# Value of KEY from /etc/tandem/tandem.env, else from the study file it names.
setting() {
  local key="$1" v study
  v=$(grep -E "^$key=" "$ETC/tandem.env" 2>/dev/null | tail -1 | cut -d= -f2-)
  if [ -z "$v" ]; then
    study=$(grep -E '^STUDY_CONFIG=' "$ETC/tandem.env" 2>/dev/null | tail -1 | cut -d= -f2-)
    [ -n "$study" ] && v=$(grep -E "^$key=" "$APP/server/$study" 2>/dev/null | tail -1 | cut -d= -f2-)
  fi
  printf '%s' "$v"
}

# Participants connected to the game right now (from the admin view), or -1 if unknown.
connected_participants() {
  local token json
  token=$(setting ADMIN_TOKEN)
  if [ -n "$token" ] && json=$(curl -fsS -H "Authorization: Bearer $token" http://127.0.0.1:8080/admin/state 2>/dev/null); then
    printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).counts.connected))'
  else
    echo -1
  fi
}
