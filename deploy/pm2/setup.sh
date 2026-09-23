#!/usr/bin/env bash
# One-time setup of Dualyne on an Ubuntu server that already runs other apps (PM2, Nginx).
# Run as root from the cloned repository:
#
#   bash deploy/pm2/setup.sh
#
# Safe to run again. It never stops, changes or removes other PM2 apps, Nginx sites,
# databases or firewall rules. What it does:
#   1. installs only the missing system packages (Postgres, Redis, Nginx, certbot)
#   2. installs Node 22 and pnpm inside this folder (.runtime/), not system-wide
#   3. creates the "dualyne" database and user (if missing) and a .env with fresh secrets
#   4. adds the Nginx site dualyne.conf and gets the HTTPS certificate (when DNS is ready)
# Then fill in the three keys in .env and run deploy/pm2/deploy.sh.
set -euo pipefail

DOMAIN="${DOMAIN:-dualyne.com}"
EMAIL="${EMAIL:-}"                     # for Let's Encrypt expiry notices (optional)
WEB_PORT="${WEB_PORT:-3100}"
API_PORT="${API_PORT:-4100}"
NODE_VERSION="${NODE_VERSION:-22.23.2}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
RUNTIME="$APP_DIR/.runtime"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash deploy/pm2/setup.sh)."
[[ -f "$APP_DIR/pnpm-lock.yaml" ]] || die "Run this from the cloned Dualyne repository."

start_service() { systemctl enable --now "$1" >/dev/null 2>&1 || service "$1" start >/dev/null 2>&1 || true; }
port_owner() { ss -ltnpH "sport = :$1" 2>/dev/null | head -1; }

# ── 1. Ports: our two apps must not collide with anything already running ──
say "Checking ports $WEB_PORT (website) and $API_PORT (API)"
for p in "$WEB_PORT" "$API_PORT"; do
  owner="$(port_owner "$p")"
  if [[ -n "$owner" ]] && ! pm2 jlist 2>/dev/null | grep -q '"name":"dualyne-'; then
    die "Port $p is already used: $owner
   Pick free ports, e.g.:  WEB_PORT=3200 API_PORT=4200 bash deploy/pm2/setup.sh"
  fi
done
web_server_check() {
  local owner
  owner="$(port_owner 80)"
  if [[ -n "$owner" && "$owner" != *'"nginx"'* ]]; then
    die "Something other than Nginx listens on port 80: $owner
   This setup adds an Nginx site. Stop here and tell your developer which web server you use."
  fi
}
web_server_check

# ── 2. System packages (only the missing ones) ──
say "Installing missing system packages"
need=()
for pkg in postgresql redis-server nginx certbot python3-certbot-nginx curl git openssl xz-utils gettext-base; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need+=("$pkg")
done
if ((${#need[@]})); then
  echo "Installing: ${need[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
else
  echo "All present."
fi
start_service postgresql
start_service redis-server
start_service nginx

# ── 3. Node 22 + pnpm, private to this folder ──
say "Node $NODE_VERSION and pnpm for Dualyne (in $RUNTIME, system Node untouched)"
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac
if [[ "$("$RUNTIME/node/bin/node" -v 2>/dev/null)" != "v$NODE_VERSION" ]]; then
  mkdir -p "$RUNTIME"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" -o "$RUNTIME/node.tar.xz"
  rm -rf "$RUNTIME/node" && mkdir -p "$RUNTIME/node"
  tar -xJf "$RUNTIME/node.tar.xz" -C "$RUNTIME/node" --strip-components=1
  rm -f "$RUNTIME/node.tar.xz"
fi
SYSTEM_PATH="$PATH"
export PATH="$RUNTIME/node/bin:$PATH"
pnpm_version="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$APP_DIR/package.json")"
if [[ "$(pnpm -v 2>/dev/null)" != "$pnpm_version" ]]; then
  npm install -g --silent "pnpm@$pnpm_version"
fi
echo "node $(node -v), pnpm $(pnpm -v)"
if ! PATH="$SYSTEM_PATH" command -v pm2 >/dev/null; then
  say "PM2 not found: installing it (with Dualyne's Node, since the server has none)"
  npm install -g --silent pm2
  ln -sf "$RUNTIME/node/bin/pm2" /usr/local/bin/pm2
  echo "To start PM2 after a reboot, run once:  pm2 startup   (and the command it prints)"
fi

# ── 4. Database and Redis ──
say "Database"
db_pass=""
if [[ -f "$ENV_FILE" ]]; then
  db_pass="$(sed -n 's#^DATABASE_URL=postgresql://dualyne:\([^@]*\)@.*#\1#p' "$ENV_FILE")"
fi
[[ -n "$db_pass" ]] || db_pass="$(openssl rand -hex 24)"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='dualyne'" | grep -q 1; then
  runuser -u postgres -- psql -qc "CREATE ROLE dualyne LOGIN PASSWORD '$db_pass'"
  echo "Created database user dualyne."
else
  runuser -u postgres -- psql -qc "ALTER ROLE dualyne PASSWORD '$db_pass'"
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='dualyne'" | grep -q 1; then
  runuser -u postgres -- createdb -O dualyne dualyne
  echo "Created database dualyne."
fi

# Redis: logical database 7, so Dualyne's keys never mix with other apps' keys.
redis_url="redis://127.0.0.1:6379/7"
if ! redis-cli -n 7 ping 2>/dev/null | grep -q PONG; then
  warn "Redis needs a password on this server. Put it in REDIS_URL in .env: redis://:PASSWORD@127.0.0.1:6379/7"
fi

# ── 5. .env (created once; existing values are kept) ──
say "Settings file $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<EOF
# Dualyne production settings. Server only, never commit. Created by deploy/pm2/setup.sh.

# ── Fill these in, then run: bash deploy/pm2/deploy.sh ──
# OpenRouter key (openrouter.ai → Keys). Secret.
OPENROUTER_API_KEY=
# Cloudflare Turnstile (dash.cloudflare.com → Turnstile → Add widget, domain ${DOMAIN}). Free.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# ── Community links (https://…). Empty = shown as "coming soon". ──
NEXT_PUBLIC_X_URL=
NEXT_PUBLIC_TELEGRAM_URL=

# ── Site ──
SITE_DOMAIN=${DOMAIN}
NEXT_PUBLIC_SITE_DOMAIN=${DOMAIN}
WEB_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
NEXT_PUBLIC_API_URL=https://api.${DOMAIN}
WEB_PORT=${WEB_PORT}
API_PORT=${API_PORT}
# Nginx on this server overwrites X-Forwarded-For; the API only listens on 127.0.0.1.
TRUST_PROXY=true
LOG_LEVEL=info

# ── Database and Redis (local to this server) ──
DATABASE_URL=postgresql://dualyne:${db_pass}@127.0.0.1:5432/dualyne
REDIS_URL=${redis_url}

# ── Secrets (generated) ──
IP_HASH_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)

# ── Model provider and safety rails ──
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_TITLE=Dualyne
DAILY_BUDGET_USD=20
COMPARE_LIMIT_PER_HOUR=10
COMPARE_MAX_TOKENS=1000
JOBS_ENABLED=true
# Optional: Slack/Discord webhook for budget alerts.
ALERT_WEBHOOK_URL=

# ── Token (fill in at launch; empty = the site shows "coming soon") ──
# Network id (1 Ethereum, 8453 Base, 42161 Arbitrum) and an RPC URL turn on-chain features on.
SIWE_CHAIN_ID=1
RPC_URL=
DLYN_TOKEN_ADDRESS=
NEXT_PUBLIC_DLYN_BUY_URL=
NEXT_PUBLIC_DLYN_CHART_URL=
NEXT_PUBLIC_EXPLORER_URL=
EOF
  chmod 600 "$ENV_FILE"
  echo "Created. Three values still need filling in (see the top of the file)."
else
  echo "Exists, kept as is."
fi

# ── 6. Nginx site ──
say "Nginx site for $DOMAIN, www.$DOMAIN and api.$DOMAIN"
site=/etc/nginx/sites-available/dualyne.conf
if [[ ! -f "$site" ]] || ! grep -q "ssl_certificate" "$site"; then
  export DOMAIN WEB_PORT API_PORT
  # shellcheck disable=SC2016 # envsubst takes the variable names literally
  envsubst '${DOMAIN} ${WEB_PORT} ${API_PORT}' <"$APP_DIR/deploy/pm2/nginx.conf.template" >"$site"
  # Servers without IPv6 cannot open [::] sockets; keep IPv4 only there.
  [[ -f /proc/net/if_inet6 ]] || sed -i '/listen \[::\]/d' "$site"
fi
ln -sf "$site" /etc/nginx/sites-enabled/dualyne.conf
nginx -t
# Reload when Nginx runs; start it when it does not (e.g. freshly installed, or stopped).
if systemctl is-active --quiet nginx 2>/dev/null || [[ -s /run/nginx.pid ]]; then
  systemctl reload nginx 2>/dev/null || nginx -s reload
else
  web_server_check
  if ! systemctl start nginx 2>/dev/null && ! nginx; then
    systemctl status nginx --no-pager -l 2>/dev/null | tail -n 8 || true
    ss -ltnp 2>/dev/null | grep -E ':(80|443) ' || true
    die "Nginx does not start (details above). Send a screenshot of this to your developer."
  fi
fi

# ── 7. HTTPS certificate (only for names that already point here) ──
say "HTTPS certificate"
server_ip="$(curl -fsS -4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
names=()
for h in "$DOMAIN" "www.$DOMAIN" "api.$DOMAIN"; do
  ip="$(getent ahostsv4 "$h" | awk 'NR==1{print $1}' || true)"
  if [[ "$ip" == "$server_ip" ]]; then
    names+=(-d "$h")
  else
    warn "$h does not point to this server yet (it resolves to '${ip:-nothing}', this server is $server_ip)."
  fi
done
if ((${#names[@]})); then
  mail=(--register-unsafely-without-email)
  [[ -n "$EMAIL" ]] && mail=(-m "$EMAIL")
  certbot --nginx --non-interactive --agree-tos --redirect --expand "${mail[@]}" "${names[@]}"
else
  warn "No certificate yet. Fix DNS, then run this script again."
fi

say "Setup done"
cat <<EOF
Next:
  1. nano $ENV_FILE      # fill OPENROUTER_API_KEY and the two Turnstile keys
  2. bash $APP_DIR/deploy/pm2/deploy.sh
EOF
