#!/bin/bash
# One-time setup of a fresh Ubuntu 22.04 / 24.04 server for Refract.
# Run as root:
#   DOMAIN=example.com EMAIL=you@example.com CF_API_TOKEN=... \
#   REPO=git@github.com:OWNER/refract.git bash server-setup.sh
#
# It installs Docker, Nginx, certbot (Cloudflare DNS challenge) and a firewall, creates the
# "deploy" user, clones the repo into /opt/refract, gets the HTTPS certificate and configures
# Nginx. It never deletes data and can be re-run safely.
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=example.com}"
: "${EMAIL:?Set EMAIL, used for certificate expiry notices}"
: "${CF_API_TOKEN:?Set CF_API_TOKEN (Cloudflare token with Zone:DNS:Edit on this domain)}"
: "${REPO:?Set REPO, e.g. git@github.com:OWNER/refract.git}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/refract}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)." >&2; exit 1; }
log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw nginx gettext-base \
  certbot python3-certbot-dns-cloudflare unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

if ! command -v docker >/dev/null; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
  systemctl restart docker
fi
systemctl enable --now docker

log "Creating user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
# Key the server uses to pull the (private) GitHub repo: add it as a read-only Deploy key.
if [ ! -f "/home/$DEPLOY_USER/.ssh/id_ed25519" ]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -q -t ed25519 -N "" -C "refract-server" -f "/home/$DEPLOY_USER/.ssh/id_ed25519"
fi
sudo -u "$DEPLOY_USER" sh -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts'

log "Preparing $APP_DIR and backup folder"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
install -d -m 750 -o root -g "$DEPLOY_USER" /var/backups/refract
if [ ! -d "$APP_DIR/.git" ]; then
  if ! sudo -u "$DEPLOY_USER" git clone -q "$REPO" "$APP_DIR"; then
    echo
    echo "Could not clone $REPO. Add this public key as a read-only Deploy key in GitHub"
    echo "(repository → Settings → Deploy keys → Add deploy key), then run this script again:"
    echo
    cat "/home/$DEPLOY_USER/.ssh/id_ed25519.pub"
    exit 1
  fi
fi

log "Getting the HTTPS certificate (Let's Encrypt, Cloudflare DNS challenge)"
install -d -m 700 /root/.secrets
umask 077
printf 'dns_cloudflare_api_token = %s\n' "$CF_API_TOKEN" > /root/.secrets/cloudflare.ini
umask 022
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot certonly --non-interactive --agree-tos -m "$EMAIL" \
    --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 \
    --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.$DOMAIN" -d "api.$DOMAIN" \
    --deploy-hook "systemctl reload nginx"
fi
systemctl enable --now certbot.timer 2>/dev/null || true

log "Configuring Nginx"
install -m 644 "$APP_DIR/deploy/nginx/refract-ssl.conf" /etc/nginx/refract-ssl.conf
[ -f /etc/nginx/cloudflare-realip.conf ] || echo "# filled by update-cloudflare-ips.sh" > /etc/nginx/cloudflare-realip.conf
# shellcheck disable=SC2016 # literal ${DOMAIN}: envsubst replaces only that variable
DOMAIN="$DOMAIN" envsubst '${DOMAIN}' < "$APP_DIR/deploy/nginx/refract.conf.template" > /etc/nginx/sites-available/refract.conf
ln -sf /etc/nginx/sites-available/refract.conf /etc/nginx/sites-enabled/refract.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "Firewall: SSH from anywhere, web ports only from Cloudflare"
ufw allow OpenSSH >/dev/null
"$APP_DIR/deploy/nginx/update-cloudflare-ips.sh"
ufw --force enable
cat > /etc/cron.weekly/refract-cloudflare-ips <<CRON
#!/bin/sh
$APP_DIR/deploy/nginx/update-cloudflare-ips.sh >/var/log/refract-cloudflare-ips.log 2>&1
CRON
chmod +x /etc/cron.weekly/refract-cloudflare-ips

if [ ! -f "$APP_DIR/.env" ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/.env.production.example" "$APP_DIR/.env"
  sed -i "s/^SITE_DOMAIN=.*/SITE_DOMAIN=$DOMAIN/; s#^WEB_ORIGINS=.*#WEB_ORIGINS=https://$DOMAIN,https://www.$DOMAIN#" "$APP_DIR/.env"
fi

log "Done"
cat <<NEXT

Next steps (see DEPLOY.md):
  1. Fill in the secrets:   sudo -u $DEPLOY_USER nano $APP_DIR/.env
  2. First deploy:          sudo -u $DEPLOY_USER $APP_DIR/deploy/scripts/deploy.sh
  3. For automatic deploys, put the GitHub Actions public key in
     /home/$DEPLOY_USER/.ssh/authorized_keys
NEXT
