#!/usr/bin/env bash
# Deploys the public demo (see CLAUDE.md § 8 and README « Démo »).
# usage: PTD_SSH=<user@host> tools/deploy/deploy-demo.sh <git-ref>
# The demo lives in /opt/ptd-demo (compose project and volume of that name), on
# 127.0.0.1:8120, with DEMO_LOGIN_EMAIL=alice@example.test. It is seeded once
# with a random password nobody is given (/opt/ptd-demo-secrets/SEED_PASSWORD,
# root only); its data is never reset (the person's choice). Prints no secret.
set -euo pipefail
ref=${1:?usage: deploy-demo.sh <git-ref>}
ssh_target=${PTD_SSH:?set PTD_SSH to the SSH target of the server}
repo=$(git rev-parse --show-toplevel)
rev=$(git -C "$repo" rev-parse --short "$ref")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive --format=tar.gz -o "$tmp/src.tar.gz" "$ref"
scp -q -o BatchMode=yes "$tmp/src.tar.gz" "$ssh_target:/tmp/ptd-demo-$rev.tar.gz"
ssh -o BatchMode=yes "$ssh_target" bash -s -- "$rev" <<'REMOTE'
set -euo pipefail
rev=$1
dir=/opt/ptd-demo
secrets=/opt/ptd-demo-secrets
install -d -m 700 "$secrets"
[ -s "$secrets/SEED_PASSWORD" ] || ( umask 077; openssl rand -hex 16 > "$secrets/SEED_PASSWORD" )
rm -rf "$dir.new"; mkdir "$dir.new"
tar xzf "/tmp/ptd-demo-$rev.tar.gz" -C "$dir.new"
rm -f "/tmp/ptd-demo-$rev.tar.gz"
printf 'APP_URL=https://demo-prends-ton-dossard.ketra.fr\nHOST_PORT=8120\nDEMO_LOGIN_EMAIL=alice@example.test\n' > "$dir.new/.env"
echo "$rev" > "$dir.new/REVISION"
rm -rf "$dir.old"; [ -d "$dir" ] && mv "$dir" "$dir.old"
mv "$dir.new" "$dir"
cd "$dir"
docker compose build -q > /tmp/ptd-demo-build.log 2>&1 || { tail -30 /tmp/ptd-demo-build.log; exit 1; }
docker compose up -d
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:8120/api/health > /dev/null && break; sleep 2; done
# The seed refuses a database that has accounts: a redeploy keeps the data.
docker compose exec -T courses /app/courses seed --force --password "$(cat "$secrets/SEED_PASSWORD")" < /dev/null > /dev/null 2>&1 \
  && echo "seeded" || echo "seed skipped (the database has accounts)"
b=https://demo-prends-ton-dossard.ketra.fr
echo "demo $(cat REVISION): health $(curl -s -o /dev/null -w '%{http_code}' $b/api/health), /api/app/demo $(curl -s $b/api/app/demo)"
echo "must be 404: push $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/push), reminders $(curl -s -o /dev/null -w '%{http_code}' $b/api/app/me/reminders), POST /mcp $(curl -s -o /dev/null -w '%{http_code}' -X POST $b/mcp)"
REMOTE
