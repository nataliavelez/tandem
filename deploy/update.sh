#!/usr/bin/env bash
# Deploy new code to a Tandem server set up by deploy/setup.sh. Run as root:
#
#   sudo bash /opt/tandem/app/deploy/update.sh [GIT_REF] [--force]
#
# GIT_REF defaults to the one used last (/etc/tandem/deploy.env). Pulls the
# code, reinstalls pinned packages, rebuilds the client and restarts the
# services. Restarting ends every session in progress (paid per PAY_ABORTED),
# so it refuses while participants are connected unless --force is given.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
# shellcheck source=/dev/null
. "$ETC/deploy.env"

FORCE=0
REF="$GIT_REF"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) REF="$arg" ;;
  esac
done

n=$(connected_participants)
if [ "$n" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
  echo "$n participant(s) are connected right now (see https://$DOMAIN/admin)." >&2
  echo "Updating restarts the server and ends their sessions. Wait, or re-run with --force." >&2
  exit 1
elif [ "$n" -lt 0 ]; then
  warn "Couldn't check for connected participants (admin view off or server down)."
  [ "$FORCE" -eq 1 ] || { echo "Re-run with --force to update anyway." >&2; exit 1; }
fi

checkout_ref "$REF"
build_app "$DOMAIN"
sed -i "s/^GIT_REF=.*/GIT_REF=$REF/" "$ETC/deploy.env"

log "Restarting services"
install -m 644 "$APP/deploy/tandem-sidecar.service" "$APP/deploy/tandem-server.service" /etc/systemd/system/
systemctl daemon-reload
since=$(date '+%Y-%m-%d %H:%M:%S')
systemctl restart tandem-sidecar tandem-server
wait_healthy "$since"
log "Updated to $(as_app git -C "$APP" rev-parse --short HEAD). Check https://$DOMAIN/admin"
