# Deploying Tandem on DigitalOcean

How to put a study online: one Ubuntu droplet runs everything, behind HTTPS.

```
participants' browsers ──HTTPS──▶ Caddy (:443)
                                   ├─ /        the built client (static files)
                                   ├─ /ws      game connection ─▶ game server (127.0.0.1:8080) ─▶ sidecar (127.0.0.1:8001)
                                   └─ /admin   admin view      ─▶ game server
data logs: /opt/tandem/data  ──(backup)──▶ DigitalOcean Space
```

Only ports 22 (SSH), 80 and 443 are open. The game server and sidecar listen on
localhost only.

Files here:

| File | What it is |
|---|---|
| `setup.sh` | First-time setup of a fresh droplet (safe to re-run) |
| `update.sh` | Deploy new code later; refuses while participants are connected |
| `lib.sh` | Shared by both scripts |
| `versions.env` | Pinned JaxMARL commit, Python and Node versions |
| `tandem-sidecar.service`, `tandem-server.service` | systemd services |
| `Caddyfile` | HTTPS and routing |
| `../sidecar/requirements-lock.txt` | Exact Python packages |

## 1. Before you start

- **Commit and push** the code you want to run. The server clones it from
  GitHub; uncommitted changes on your laptop are not deployed.
- **A domain or subdomain** you control, e.g. `study.yourlab.org`.
- **Prolific completion codes**: one for finishing, one for "aborted" (our
  side ended the study; paid), optionally one for drop-outs.

## 2. Create the droplet

In the DigitalOcean console, create a droplet:

- Image: **Ubuntu 24.04 (LTS) x64**
- Size: **4 GB RAM / 2 vCPUs** is enough for a pilot. Run a load test before
  running many groups at once.
- Region: close to your participants (e.g. New York or San Francisco for US
  Prolific samples). Each key press makes a round trip to the server.
- Authentication: **SSH key**. Add your laptop's public key
  (`cat ~/.ssh/id_ed25519.pub`; create one with `ssh-keygen -t ed25519` if
  you don't have one).

## 3. Point the domain at it

Add a DNS **A record**: `study.yourlab.org` → the droplet's IP address. Check
from your laptop: `dig +short study.yourlab.org` should print the IP. HTTPS
certificates can only be issued once this works.

## 4. Run the setup script

From the repo on your laptop:

```sh
scp deploy/setup.sh root@<droplet-ip>:
ssh root@<droplet-ip>
sudo DOMAIN=study.yourlab.org GIT_REF=main bash setup.sh
```

- `GIT_REF` is the branch, tag or commit to deploy.
- If the GitHub repo is **private**, add
  `REPO_URL=git@github.com:nataliavelez/tandem.git`. The first run creates
  a key and stops. Add that key on GitHub (repo → Settings → Deploy keys →
  Add deploy key, **read-only**), then run the same command again.
- Optional: `ACME_EMAIL=you@yourlab.org` for certificate notices.

It takes about 10 minutes. It installs Node, Python (via uv) and Caddy; clones
the code and JaxMARL at the pinned commit; installs the exact Python packages;
builds the client; starts both services; and sets up HTTPS and the firewall.

## 5. Configure the study

Setup creates a starter study file with a random admin token:

```sh
sudo -u tandem nano /opt/tandem/app/server/studies/pilot.env
```

Set at least:

- `STUDY_NAME`, `CONDITION`
- `GAME=overcooked`, `LAYOUT`, `REQUIRED_PLAYERS`, `MIN_GROUP_SIZE`
- `ROUNDS`: must equal the number of `"game"` screens in
  `client/src/scripts/expTimeline.ts`
- `HORIZON`, `TICK_MS`
- `LOBBY_TIMEOUT_MS` (default 10 minutes), `MAX_ROOMS` (empty = unlimited),
  `MIN_START_SIZE` (start short at the lobby timeout; empty = never)
- Solo practice: `PRACTICE=true`, `PRACTICE_LAYOUT`, `PRACTICE_HORIZON`,
  `PRACTICE_MIN_SOUPS`, `PRACTICE_TIME_LIMIT_MS`; `PAY_PRACTICE_TIMEOUT` +
  `PRACTICE_TIMEOUT_COMPLETION_URL`
- `COMPLETION_URL`, `PAY_ABORTED` + `ABORTED_COMPLETION_URL`, `PAY_NO_GROUP`
  + `NO_GROUP_COMPLETION_URL`, `PAY_DROPPED` + `DROPPED_COMPLETION_URL`

Group size, minimum group size, smallest group to start, lobby timeout and the
number of rooms can also be changed live on the admin page. Those changes last until the server restarts,
so put the values you want to keep in the study file.

Leave `PORT` and `HOST` alone: `/etc/tandem/tandem.env` sets them for this
server, and its values win over the study file.

To run a different study file, change `STUDY_CONFIG` in
`/etc/tandem/tandem.env`. For example, use a separate `studies/deploy-test.env`
for testing, so test data is labeled as such.

**Data backup (recommended).** In DigitalOcean, create a **Space** (Spaces
Object Storage), ideally in the droplet's region. Then create a **Spaces access
key** limited to that bucket. In the study file:

```
BACKUP_S3_BUCKET=<space name>
BACKUP_S3_ENDPOINT=https://<region>.digitaloceanspaces.com
BACKUP_S3_REGION=<region>          # e.g. nyc3
```

Put the key pair in `/etc/tandem/tandem.env`, never in the study file or the
repo:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Apply the changes and read the startup messages (settings in use, warnings):

```sh
sudo systemctl restart tandem-server
sudo journalctl -u tandem-server -n 30 --no-pager
```

## 6. Check it works (before any participant)

1. **Admin view**: open `https://study.yourlab.org/admin`. The token is printed
   by `sudo grep ADMIN_TOKEN /opt/tandem/app/server/studies/pilot.env`. It
   should show *sidecar OK*, and *backup OK* once a file has been uploaded.
2. **Play it**: open `https://study.yourlab.org/?PROLIFIC_PID=test_1` and more
   windows with `test_2`, `test_3`… (one per player). Play through to the end;
   you should be sent to your completion URL.
3. **Data**: `ls -l /opt/tandem/data` shows a log per room plus a participants
   log. The files appear in the Space when a room closes, and every 5 minutes.

## 7. Prolific

- Study URL:
  `https://study.yourlab.org/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`
- Completion: choose redirect, and match each Prolific code to
  `COMPLETION_URL` / `ABORTED_COMPLETION_URL` / `NO_GROUP_COMPLETION_URL` /
  `DROPPED_COMPLETION_URL`.
- Devices: **desktop only**; the game needs a keyboard.

## 8. During a session

- Keep `/admin` open: rooms, who is where, and server health. Use its
  Settings to adjust group size, lobby timeout and how many groups to open as
  people arrive.
- **Don't restart or update while anyone is connected.** Stopping the server
  ends every session in progress (paid per `PAY_ABORTED`).
- Live server log: `sudo journalctl -fu tandem-server`

## 9. Updating the code

Commit and push, then on the droplet:

```sh
sudo bash /opt/tandem/app/deploy/update.sh            # same branch/ref as last time
sudo bash /opt/tandem/app/deploy/update.sh my-branch  # or another ref
```

It refuses while participants are connected (checked through the admin view).
`--force` overrides that.

## 10. Getting the data

The data is in the Space, or copy it straight from the server:
`scp -r root@<droplet-ip>:/opt/tandem/data ./data-$(date +%F)`

The logs contain Prolific IDs; handle them as personal data.

## Troubleshooting

| Symptom | Look at |
|---|---|
| Browser certificate error | DNS not pointing at the droplet yet, or port 80 blocked: `journalctl -u caddy -n 50` |
| Admin view says *sidecar DOWN* | `journalctl -u tandem-sidecar -n 50` |
| Game server keeps restarting | A settings problem, e.g. more players than the layout's spawns: `journalctl -u tandem-server -n 50` |
| *backup failing* in the admin view | Bucket name, endpoint, region and keys; the error is shown when you hover over the badge |
| Data logs say `code.dirty=true` | Files on the server differ from the commit: `sudo -u tandem git -C /opt/tandem/app status` |

## Security notes

- Firewall: only SSH, HTTP and HTTPS. The game server and sidecar are reachable
  only from the droplet itself.
- Study files (completion codes, admin token) are readable only by the `tandem`
  user. `/etc/tandem/tandem.env` (keys) is readable by root and `tandem`.
- Caddy keeps no access log, because the URLs contain Prolific IDs.
- Ubuntu installs security updates automatically. For other updates, run
  `sudo apt update && sudo apt upgrade` between sessions, not during them.

## Status

`setup.sh` and `update.sh` have not yet been run on a real droplet. They were
written for Ubuntu 24.04 and syntax-checked. The Caddy config was validated with
Caddy 2.8, and the same layout (production client build, game server on
localhost, this Caddyfile) was tested end to end on a laptop over plain HTTP.
Expect to fix small things on the first real run.
