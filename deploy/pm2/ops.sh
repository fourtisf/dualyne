#!/usr/bin/env bash
# Day-to-day operations for Dualyne under PM2. Run as root from the app folder:
#
#   bash deploy/pm2/ops.sh telegram   # connect a Telegram bot for alerts (asks for the bot token)
#   bash deploy/pm2/ops.sh install    # daily database backup + a health check every 5 minutes (cron)
#   bash deploy/pm2/ops.sh backup     # back up the database now
#   bash deploy/pm2/ops.sh watchdog   # check the site and the API once
#
# Backups: /var/backups/dualyne/dualyne-YYYYMMDD-HHMM.sql.gz, the last 14 days are kept.
# Alerts go to Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are in .env.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${DUALYNE_ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${DUALYNE_BACKUP_DIR:-/var/backups/dualyne}"
STATE_DIR="${DUALYNE_STATE_DIR:-/var/lib/dualyne}"
KEEP_DAYS=14

say() { printf '%s %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { printf 'xx %s\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Run deploy/pm2/setup.sh first."
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
TG_API="${TELEGRAM_API_URL:-https://api.telegram.org}"

# Telegram Bot API call; the token goes through curl's config on stdin, so it never shows in `ps`.
tg() {
  local method="$1"
  shift
  printf 'url = "%s/bot%s/%s"\n' "$TG_API" "$TELEGRAM_BOT_TOKEN" "$method" |
    curl -sS --max-time 15 -K - "$@"
}

notify() {
  say "$*"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    tg sendMessage --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" \
      -d disable_web_page_preview=true >/dev/null || say "telegram message failed"
  fi
}

set_env() { # set_env KEY VALUE: replace the line in .env, or add it
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

backup() {
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is empty in $ENV_FILE"
  command -v pg_dump >/dev/null || die "pg_dump not found (apt-get install postgresql-client)"
  install -d -m 700 "$BACKUP_DIR"
  local file
  file="$BACKUP_DIR/dualyne-$(date -u +%Y%m%d-%H%M).sql.gz"
  if ! pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 >"$file.part"; then
    rm -f "$file.part"
    notify "❌ Dualyne backup failed on $(hostname). Check /var/log/dualyne-ops.log"
    exit 1
  fi
  mv "$file.part" "$file"
  chmod 600 "$file"
  find "$BACKUP_DIR" -name 'dualyne-*.sql.gz' -type f -mtime "+$((KEEP_DAYS - 1))" -delete
  say "backup ok: $file ($(du -h "$file" | cut -f1)), $(find "$BACKUP_DIR" -name 'dualyne-*.sql.gz' | wc -l) kept"
}

# One health check. Tells Telegram only when something changes (down, or back up), and restarts
# an app that failed two checks in a row (PM2 already restarts apps that crash; this catches hangs).
watchdog() {
  install -d -m 700 "$STATE_DIR"
  local state="$STATE_DIR/watchdog" prev="" problems=()
  [[ -f "$state" ]] && prev="$(cat "$state")"
  local api_port="${API_PORT:-4100}" web_port="${WEB_PORT:-3100}" domain="${SITE_DOMAIN:-}"

  curl -fsS --max-time 10 "http://127.0.0.1:$api_port/health" 2>/dev/null | grep -q '"status":"ok"' ||
    problems+=("api")
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$web_port/health" 2>/dev/null)" == 200 ]] ||
    problems+=("website")
  if [[ -n "$domain" && "${WATCHDOG_PUBLIC:-1}" == 1 ]]; then
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$domain/" 2>/dev/null)" == 200 ]] ||
      problems+=("https://$domain")
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://api.$domain/health" 2>/dev/null)" == 200 ]] ||
      problems+=("https://api.$domain")
  fi

  local now="ok"
  ((${#problems[@]})) && now="${problems[*]}"

  # Second failed check in a row for a local app: restart it.
  local restarted=()
  for app in api website; do
    if [[ " $now " == *" $app "* && " $prev " == *" $app "* ]] && command -v pm2 >/dev/null; then
      local name="dualyne-api"
      [[ $app == website ]] && name="dualyne-web"
      pm2 restart "$name" >/dev/null 2>&1 && restarted+=("$name")
    fi
  done

  if [[ "$now" != "$prev" ]]; then
    if [[ "$now" == ok ]]; then
      [[ -n "$prev" ]] && notify "✅ Dualyne is back up (was down: $prev)"
    else
      notify "🔴 Dualyne problem on $(hostname): not answering: $now"
    fi
  elif ((${#restarted[@]})); then
    notify "🔁 Dualyne: restarted ${restarted[*]} after two failed health checks"
  fi
  printf '%s' "$now" >"$state"
  say "watchdog: $now${restarted:+ (restarted ${restarted[*]})}"
}

install_cron() {
  [[ $EUID -eq 0 ]] || die "Run as root."
  local path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" bin
  for bin in pm2 node; do
    if command -v "$bin" >/dev/null; then path="$(dirname "$(command -v "$bin")"):$path"; fi
  done
  cat >/etc/cron.d/dualyne <<EOF
# Dualyne: database backup every day at 03:30 (server time), health check every 5 minutes.
# Made by $APP_DIR/deploy/pm2/ops.sh install. Log: /var/log/dualyne-ops.log
SHELL=/bin/bash
PATH=$path
30 3 * * * root bash $APP_DIR/deploy/pm2/ops.sh backup >> /var/log/dualyne-ops.log 2>&1
*/5 * * * * root bash $APP_DIR/deploy/pm2/ops.sh watchdog >> /var/log/dualyne-ops.log 2>&1
EOF
  chmod 644 /etc/cron.d/dualyne
  cat >/etc/logrotate.d/dualyne <<'EOF'
/var/log/dualyne-ops.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
}
EOF
  say "cron installed: /etc/cron.d/dualyne"
  backup
  watchdog
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]] ||
    say "No Telegram bot yet: run 'bash deploy/pm2/ops.sh telegram' to get alerts on your phone."
}

telegram_setup() {
  cat <<'EOF'
Connect a Telegram bot for Dualyne alerts:
  1. In Telegram, open @BotFather, send /newbot, pick a name and a username.
  2. BotFather replies with a token like 123456789:AAH...  Paste it below.
EOF
  local token
  read -rsp "Bot token (hidden): " token </dev/tty
  echo
  [[ "$token" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] || die "That doesn't look like a bot token."
  TELEGRAM_BOT_TOKEN="$token"
  local me
  me="$(tg getMe)" || die "Telegram didn't answer. Check the server's internet connection."
  [[ "$me" == *'"ok":true'* ]] || die "Telegram rejected the token. Copy it again from @BotFather."
  local bot
  bot="$(sed -n 's/.*"username":"\([^"]*\)".*/\1/p' <<<"$me")"
  echo "Now open Telegram and send any message (for example: hi) to @$bot. Waiting up to 2 minutes…"
  local chat="" i updates
  for ((i = 0; i < 24; i++)); do
    updates="$(tg getUpdates -G -d timeout=0 || true)"
    chat="$(grep -o '"chat":{"id":-\{0,1\}[0-9]*' <<<"$updates" | tail -1 | grep -o -- '-\{0,1\}[0-9]*$' || true)"
    [[ -n "$chat" ]] && break
    sleep 5
  done
  [[ -n "$chat" ]] || die "No message arrived. Send a message to @$bot, then run this again."
  set_env TELEGRAM_BOT_TOKEN "$token"
  set_env TELEGRAM_CHAT_ID "$chat"
  TELEGRAM_CHAT_ID="$chat"
  notify "✅ Dualyne alerts are connected. You'll get a message here if the site goes down, when OpenRouter credit runs low, and when the daily budget is used up."
  echo "Saved to $ENV_FILE. Run 'bash deploy/pm2/deploy.sh' so the API sends its alerts here too."
}

case "${1:-}" in
  backup) backup ;;
  watchdog) watchdog ;;
  install) install_cron ;;
  telegram) telegram_setup ;;
  *) die "Usage: bash deploy/pm2/ops.sh telegram | install | backup | watchdog" ;;
esac
