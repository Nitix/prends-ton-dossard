#!/usr/bin/env bash
# Deploys « Prends ton dossard » in production, after the person's OK (see CLAUDE.md § 8).
# usage: PTD_SSH=<user@host> tools/deploy/deploy-prod.sh <git-ref>
# A fresh source dir, the image built while the site still runs, then: stop,
# back up the volume, start, health checks. The previous source stays as
# /opt/prends-ton-dossard.old-<rev> (only the last one). Prints no secret.
set -euo pipefail
ref=${1:?usage: deploy-prod.sh <git-ref>}
ssh_target=${PTD_SSH:?set PTD_SSH to the SSH target of the server}
repo=$(git rev-parse --show-toplevel)
rev=$(git -C "$repo" rev-parse --short "$ref")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive --format=tar.gz -o "$tmp/src.tar.gz" "$ref"
scp -q -o BatchMode=yes "$tmp/src.tar.gz" "$ssh_target:/tmp/ptd-prod-$rev.tar.gz"
ssh -o BatchMode=yes "$ssh_target" bash -s -- "$rev" <<'REMOTE'
set -euo pipefail
rev=$1
dir=/opt/prends-ton-dossard
live=$(cat "$dir/REVISION")
echo "live: $live → new: $rev"
if grep -q '^DEMO_LOGIN_EMAIL' "$dir/.env"; then echo "DEMO_LOGIN_EMAIL in the prod .env: abort" >&2; exit 1; fi
rm -rf "$dir.new"; mkdir "$dir.new"
tar xzf "/tmp/ptd-prod-$rev.tar.gz" -C "$dir.new"
rm -f "/tmp/ptd-prod-$rev.tar.gz"
cp "$dir/.env" "$dir.new/.env"
echo "$rev" > "$dir.new/REVISION"
for old in "$dir".old-*; do [ -d "$old" ] && rm -rf "$old"; done
mv "$dir" "$dir.old-$live"
mv "$dir.new" "$dir"
cd "$dir"
docker compose build -q > /tmp/ptd-prod-build.log 2>&1 || { tail -30 /tmp/ptd-prod-build.log; exit 1; }
docker compose stop
backup="/root/backups/prends-ton-dossard-pb_data-$live-$(date +%Y%m%d-%H%M).tar.gz"
docker run --rm --user 0 --entrypoint tar -v prends-ton-dossard_pb_data:/data:ro -v /root/backups:/backup \
  prends-ton-dossard-courses czf "/backup/$(basename "$backup")" -C /data .
ls -la "$backup"
docker compose up -d
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:8096/api/health > /dev/null && break; sleep 2; done
b=https://prends-ton-dossard.ketra.fr
echo "health: local $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8096/api/health), https $(curl -s -o /dev/null -w '%{http_code}' $b/api/health)"
echo "must be 404: /_/ $(curl -s -o /dev/null -w '%{http_code}' $b/_/), /api/app/demo $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/demo)"
echo "must be 401: /api/app/push $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/push), POST /mcp $(curl -s -o /dev/null -w '%{http_code}' -X POST $b/mcp)"
echo "restarts: $(docker inspect -f '{{.RestartCount}}' prends-ton-dossard-courses-1), revision: $(cat REVISION)"
REMOTE
