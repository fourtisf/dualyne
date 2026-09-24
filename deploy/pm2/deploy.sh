#!/usr/bin/env bash
# Build and (re)start Dualyne under PM2. Run after setup.sh, and again for every update:
#
#   bash deploy/pm2/deploy.sh            # pull the latest code, build, migrate, reload
#   SKIP_PULL=1 bash deploy/pm2/deploy.sh
#
# Only the two Dualyne apps (dualyne-api, dualyne-web) are started or reloaded.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
# Build with Dualyne's own Node, but talk to PM2 with the system PATH: the PM2 daemon and the
# other apps on this server keep their Node. Dualyne's apps name their interpreter explicitly.
SYSTEM_PATH="$PATH"
export PATH="$APP_DIR/.runtime/node/bin:$PATH"
pm2() { PATH="$SYSTEM_PATH" command pm2 "$@"; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }

cd "$APP_DIR"
[[ -x .runtime/node/bin/node ]] || die "Run deploy/pm2/setup.sh first."
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Run deploy/pm2/setup.sh first."
PATH="$SYSTEM_PATH" command -v pm2 >/dev/null || die "PM2 not found. Run deploy/pm2/setup.sh first."

# Settings: exported for the build (NEXT_PUBLIC_* are baked into the website) and the migration.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
unset NODE_ENV # install needs dev dependencies (build tools); PM2 sets production at run time
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  warn "OPENROUTER_API_KEY is empty: the site goes live in preview. Comparisons and the API say
   \"opening soon\" until you add the key and run this again."
elif [[ -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  warn "No Turnstile keys: free comparisons have no bot check. Spending is still capped by the per-IP
   limit and DAILY_BUDGET_USD (${DAILY_BUDGET_USD:-20} USD/day); keep that low."
fi
# Website copies of API settings, so each value is written once in .env.
export NEXT_PUBLIC_SITE_DOMAIN="${NEXT_PUBLIC_SITE_DOMAIN:-$SITE_DOMAIN}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.$SITE_DOMAIN}"
export NEXT_PUBLIC_SIWE_CHAIN_ID="${NEXT_PUBLIC_SIWE_CHAIN_ID:-${SIWE_CHAIN_ID:-1}}"
export NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR="${NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR:-${COMPARE_LIMIT_PER_HOUR:-10}}"
export NEXT_PUBLIC_DLYN_TOKEN_ADDRESS="${NEXT_PUBLIC_DLYN_TOKEN_ADDRESS:-${DLYN_TOKEN_ADDRESS:-}}"

if [[ -z "${SKIP_PULL:-}" ]]; then
  say "Pulling the latest code"
  git pull --ff-only
fi

say "Installing dependencies"
pnpm install --frozen-lockfile

say "Building the API"
pnpm --filter @dualyne/api build

say "Database migrations and model catalog"
(cd apps/api && node_modules/.bin/prisma migrate deploy && node dist/seed.js)

say "Building the website (1–3 minutes)"
pnpm --filter @dualyne/web build

# The live site runs from its own copy of each build (.release/web/<time>), never from
# apps/web/.next: a build wipes that folder, which would leave the running site without its
# styles and scripts. "current" switches to the new copy in one step.
releases="$APP_DIR/.release/web"
release="$releases/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$releases"
cp -a apps/web/.next/standalone "$release"
cp -a apps/web/.next/static "$release/apps/web/.next/static"
[[ -d apps/web/public ]] && cp -a apps/web/public "$release/apps/web/public"
previous="$(readlink "$releases/current" 2>/dev/null || true)"
switch_to() { ln -sfn "$1" "$releases/current.new" && mv -Tf "$releases/current.new" "$releases/current"; }
switch_to "$release"

say "Starting with PM2"
# Before .release existed, dualyne-web ran from apps/web/.next/standalone: start it fresh once.
web_cwd="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{const a=JSON.parse(s).find((x)=>x.name==="dualyne-web");process.stdout.write(a?a.pm2_env.pm_cwd:"")}catch{}})')"
if [[ -n "$web_cwd" && "$web_cwd" != "$releases"/* ]]; then
  pm2 delete dualyne-web >/dev/null
fi
pm2 startOrReload deploy/pm2/ecosystem.config.cjs --update-env
# Remember the running apps (yours and Dualyne's) for "pm2 resurrect" after a reboot.
pm2 save >/dev/null

say "Health checks"
ok=1
for _ in $(seq 1 30); do
  api=$(curl -fsS "http://127.0.0.1:${API_PORT:-4100}/health" 2>/dev/null || true)
  web=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT:-3100}/health" 2>/dev/null || true)
  if [[ "$api" == *'"status":"ok"'* && "$web" == 200 ]]; then ok=0; break; fi
  sleep 2
done
pm2 list
if ((ok)); then
  echo "API: ${api:-no answer}   website: HTTP ${web:-no answer}"
  if [[ -n "$previous" && -d "$previous" && "$web" != 200 ]]; then
    switch_to "$previous"
    pm2 reload dualyne-web --update-env >/dev/null
    warn "The new website did not start; the previous version is live again."
  fi
  die "Not healthy yet. Look at the logs:  pm2 logs dualyne-api --lines 50   pm2 logs dualyne-web --lines 50"
fi
# Keep the three newest copies (the live one and two to fall back to).
find "$releases" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r | tail -n +4 | xargs -r rm -rf
echo "API ok, website ok."
echo "Live at https://${SITE_DOMAIN} and https://api.${SITE_DOMAIN}/v1/models"
