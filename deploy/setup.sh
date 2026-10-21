#!/usr/bin/env bash
# First-time setup of a Tandem server on a fresh Ubuntu 24.04 droplet. Safe to
# re-run (e.g. after adding a deploy key). Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<ref>/deploy/setup.sh -o setup.sh
#   sudo DOMAIN=study.example.org GIT_REF=main bash setup.sh
#
# Settings (environment variables):
#   DOMAIN      (required) the domain whose DNS A record points at this server
#   GIT_REF     branch, tag or commit to deploy (default: main)
#   REPO_URL    default https://github.com/nataliavelez/colab-tandem.git; for a
#               private repo use git@github.com:nataliavelez/colab-tandem.git
#               (the script then makes a read-only deploy key and stops so you
#               can add it on GitHub; re-run afterwards)
#   ACME_EMAIL  optional: email for Let's Encrypt certificate notices
#
# What it does: installs Node, uv/Python, Caddy; creates the "tandem" user;
# clones the repo and JaxMARL (pinned commit); installs pinned Python packages;
# builds the client; creates /etc/tandem/tandem.env and a starter study file
# (studies/pilot.env, with a random ADMIN_TOKEN); installs and starts the two
# services; configures HTTPS (Caddy) and the firewall. See deploy/README.md.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. sudo DOMAIN=study.example.org bash setup.sh}"
GIT_REF="${GIT_REF:-main}"
REPO_URL="${REPO_URL:-https://github.com/nataliavelez/colab-tandem.git}"
ACME_EMAIL="${ACME_EMAIL:-}"

# Until the repo is cloned, lib.sh isn't on disk: minimal helpers first
APP_USER=tandem
BASE=/opt/tandem
APP=$BASE/app
log() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root: sudo DOMAIN=... bash $0" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}" >&2

log "System packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates gnupg build-essential ufw \
  debian-keyring debian-archive-keyring apt-transport-https

# JAX + the client build need memory; add swap on small droplets
mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 3900000 ] && [ -z "$(swapon --show)" ]; then
  log "Adding 2 GB swap (this droplet has less than 4 GB of memory)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "App user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE/home" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$BASE" "$BASE/data" "$BASE/python" /etc/tandem
chown "$APP_USER:" "$BASE" "$BASE/data" "$BASE/python"
chmod 755 "$BASE"
chmod 750 "$BASE/data"

log "Code ($REPO_URL)"
if [ ! -d "$APP/.git" ]; then
  if [[ "$REPO_URL" == git@* ]]; then
    key="$BASE/home/.ssh/id_ed25519"
    if [ ! -f "$key" ]; then
      sudo -u "$APP_USER" -H mkdir -p "$BASE/home/.ssh"
      sudo -u "$APP_USER" -H ssh-keygen -t ed25519 -N "" -C "tandem-deploy@$DOMAIN" -f "$key" >/dev/null
      sudo -u "$APP_USER" -H bash -c "ssh-keyscan -t ed25519 github.com >> '$BASE/home/.ssh/known_hosts' 2>/dev/null"
    fi
    if ! sudo -u "$APP_USER" -H git ls-remote "$REPO_URL" >/dev/null 2>&1; then
      echo
      echo "The repo is private. Add this key on GitHub: repo → Settings → Deploy keys → Add deploy key"
      echo "(read-only; leave \"Allow write access\" unchecked), then run this script again:"
      echo
      cat "$key.pub"
      exit 2
    fi
  fi
  sudo -u "$APP_USER" -H git clone "$REPO_URL" "$APP"
fi

# From here on, the shared helpers and pinned versions come from the repo
# shellcheck source=deploy/lib.sh
. "$APP/deploy/lib.sh"
checkout_ref "$GIT_REF"
# shellcheck source=deploy/versions.env
. "$APP/deploy/versions.env"

log "Node.js $NODE_MAJOR"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node --version

log "uv (Python installer)"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh
uv --version

build_app "$DOMAIN"

log "Settings: /etc/tandem"
cat > "$ETC/deploy.env" <<EOF
# Written by deploy/setup.sh; read by deploy/update.sh
DOMAIN=$DOMAIN
GIT_REF=$GIT_REF
EOF
if [ ! -f "$ETC/tandem.env" ]; then
  cat > "$ETC/tandem.env" <<'EOF'
# Settings for this server (read by tandem-server.service). Values here override
# the study file. Keep secrets here, never in the repo.

# Which study settings file to run (relative to /opt/tandem/app/server)
STUDY_CONFIG=studies/pilot.env

# Fixed for this deployment: only Caddy (HTTPS) talks to the game server
HOST=127.0.0.1
PORT=8080
SIDECAR_URL=http://127.0.0.1:8001
DATA_DIR=/opt/tandem/data

# Off-server backup: the DigitalOcean Spaces access key (bucket etc. go in the study file)
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
EOF
fi
chown root:"$APP_USER" "$ETC/tandem.env" "$ETC/deploy.env"
chmod 640 "$ETC/tandem.env" "$ETC/deploy.env"

# Starter study file with a random admin token (studies/*.env are gitignored)
study="$APP/server/studies/pilot.env"
if [ ! -f "$study" ]; then
  as_app cp "$APP/server/studies/example.env" "$study"
  token=$(openssl rand -hex 24)
  as_app sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$token/" "$study"
fi
chmod 750 "$APP/server/studies"
chmod 640 "$APP"/server/studies/*.env

log "Services"
install -m 644 "$APP/deploy/tandem-sidecar.service" /etc/systemd/system/
install -m 644 "$APP/deploy/tandem-server.service" /etc/systemd/system/
systemctl daemon-reload
since=$(date '+%Y-%m-%d %H:%M:%S')
systemctl enable tandem-sidecar tandem-server
systemctl restart tandem-sidecar tandem-server
wait_healthy "$since" || true

log "HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
{
  if [ -n "$ACME_EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"; fi
  sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/Caddyfile"
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

log "Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status

log "Checking https://$DOMAIN"
if curl -fsS -o /dev/null --max-time 30 "https://$DOMAIN/"; then
  echo "https://$DOMAIN is up"
else
  warn "https://$DOMAIN did not answer yet. If the DNS record is new, wait a few minutes; Caddy retries the certificate. Logs: journalctl -u caddy -n 50"
fi

cat <<EOF

Done. Next steps (deploy/README.md has details):
  1. Edit the study settings:   sudo -u tandem nano $study
     (STUDY_NAME, CONDITION, GAME, REQUIRED_PLAYERS, ROUNDS, COMPLETION_URL and
      the other completion codes, BACKUP_S3_*; keep PORT/HOST as they are)
  2. Backup keys, if used:      sudo nano $ETC/tandem.env
  3. Apply:                     sudo systemctl restart tandem-server
  4. Admin view:                https://$DOMAIN/admin
     token:                     sudo grep ADMIN_TOKEN $study
  5. Study link for Prolific:   https://$DOMAIN/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
EOF
