#!/usr/bin/env bash
# Deploys the dev environment, where a version is tried in real conditions before
# production (see CLAUDE.md § 8 and README « Environnement de dev »).
# usage: PTD_SSH=<user@host> tools/deploy/deploy-dev.sh <git-ref>
# /opt/ptd-dev (compose project and volume « ptd-dev »), 127.0.0.1:8130, no
# DEMO_LOGIN_EMAIL. Seeded once; the seed password is made once in
# /opt/ptd-dev-secrets/SEED_PASSWORD (root only) and never printed. The Caddy
# route is set up once, by hand (CLAUDE.md § 8).
set -euo pipefail
ref=${1:?usage: deploy-dev.sh <git-ref>}
ssh_target=${PTD_SSH:?set PTD_SSH to the SSH target of the server}
repo=$(git rev-parse --show-toplevel)
rev=$(git -C "$repo" rev-parse --short "$ref")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive --format=tar.gz -o "$tmp/src.tar.gz" "$ref"
scp -q -o BatchMode=yes "$tmp/src.tar.gz" "$ssh_target:/tmp/ptd-dev-$rev.tar.gz"
ssh -o BatchMode=yes "$ssh_target" bash -s -- "$rev" <<'REMOTE'
set -euo pipefail
rev=$1
dir=/opt/ptd-dev
secrets=/opt/ptd-dev-secrets
install -d -m 700 "$secrets"
[ -s "$secrets/SEED_PASSWORD" ] || ( umask 077; openssl rand -base64 24 > "$secrets/SEED_PASSWORD" )
rm -rf "$dir.new"; mkdir "$dir.new"
tar xzf "/tmp/ptd-dev-$rev.tar.gz" -C "$dir.new"
rm -f "/tmp/ptd-dev-$rev.tar.gz"
echo "$rev" > "$dir.new/REVISION"
if [ -f "$dir/.env" ]; then cp "$dir/.env" "$dir.new/.env"
else printf 'APP_URL=https://dev-prends-ton-dossard.ketra.fr\nHOST_PORT=8130\n' > "$dir.new/.env"; fi
if grep -q '^DEMO_LOGIN_EMAIL=' "$dir.new/.env"; then echo "DEMO_LOGIN_EMAIL in the dev .env: refused" >&2; exit 1; fi
# Build first, with the project name of the live dir, so the site runs meanwhile.
(cd "$dir.new" && docker compose -p ptd-dev build -q > /tmp/ptd-dev-build.log 2>&1) || { tail -30 /tmp/ptd-dev-build.log; exit 1; }
if [ -d "$dir" ]; then
  old=$(cat "$dir/REVISION" 2>/dev/null || echo old)
  (cd "$dir" && docker compose stop courses) || true
  rm -rf "$dir".old-* && mv "$dir" "$dir.old-$old"
fi
mv "$dir.new" "$dir"
cd "$dir"
docker compose up -d
for _ in $(seq 1 45); do curl -fs http://127.0.0.1:8130/api/health > /dev/null && break; sleep 2; done
docker compose exec -T -e SEED_PASSWORD="$(cat "$secrets/SEED_PASSWORD")" courses /app/courses seed --force < /dev/null > /dev/null 2>&1 \
  && echo "seeded" || echo "seed skipped (the database has accounts)"
b=https://dev-prends-ton-dossard.ketra.fr
echo "dev $(cat REVISION): health $(curl -s -o /dev/null -w '%{http_code}' $b/api/health), restarts $(docker inspect -f '{{.RestartCount}}' ptd-dev-courses-1)"
echo "must be 404: /_/ $(curl -s -o /dev/null -w '%{http_code}' $b/_/), /api/app/demo $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/demo)"
echo "must be 401: /api/app/push $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/push), POST /mcp $(curl -s -o /dev/null -w '%{http_code}' -X POST $b/mcp)"
REMOTE
