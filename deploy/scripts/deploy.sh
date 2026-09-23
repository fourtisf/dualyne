#!/bin/bash
# Deploy (or roll back) Refract on the server. Run as the deploy user from anywhere:
#   deploy.sh                 deploy the latest origin/main
#   deploy.sh <git-sha>       deploy a specific commit
#   deploy.sh --rollback      go back to the previously deployed commit
#   deploy.sh --rollback <sha>
#
# Steps: check out the commit, build images tagged with it, start the stack (migrations
# run first), wait for both /health endpoints, and automatically return to the previous
# version if the new one does not become healthy. Volumes and data are never touched.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
STATE="$ROOT/.deploy"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml")
KEEP_IMAGES=5
HEALTH_TIMEOUT=180

log() { printf '\033[1;35m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ROOT/.env" ] || die "Missing $ROOT/.env (copy .env.production.example and fill it in)."
mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || die "Another deploy is running."

current="$(cat "$STATE/current" 2>/dev/null || true)"
rollback=false
if [ "${1:-}" = "--rollback" ]; then
  rollback=true
  target="${2:-$(grep -v "^${current}\$" "$STATE/history" 2>/dev/null | tail -1 || true)}"
  [ -n "$target" ] || die "No previous version to roll back to."
else
  git fetch --quiet origin main
  target="$(git rev-parse "${1:-origin/main}^{commit}")"
fi

log "Deploying $target (current: ${current:-none})"
git checkout --quiet --force --detach "$target"
export IMAGE_TAG="${target:0:12}"

if docker image inspect "refract-api:$IMAGE_TAG" >/dev/null 2>&1 &&
   docker image inspect "refract-web:$IMAGE_TAG" >/dev/null 2>&1; then
  log "Images for $IMAGE_TAG already exist, skipping build"
else
  log "Building images $IMAGE_TAG"
  "${COMPOSE[@]}" build migrate web
fi

healthy() {
  curl -fs --max-time 5 http://127.0.0.1:4000/health >/dev/null &&
    curl -fs --max-time 5 http://127.0.0.1:3000/health >/dev/null
}

back_out() {
  if ! $rollback && [ -n "$current" ] && [ "$current" != "$target" ]; then
    log "New version is not healthy. Rolling back to $current"
    # Release our lock so the rollback run can take it.
    flock -u 9
    exec 9>&-
    "$ROOT/deploy/scripts/deploy.sh" --rollback "$current" || true
  fi
  die "Deploy of $target failed. Logs: docker compose -f docker-compose.prod.yml logs --tail=100 api web migrate"
}

log "Starting containers (migrations run first)"
if ! "${COMPOSE[@]}" up -d --remove-orphans; then
  "${COMPOSE[@]}" logs --tail=50 migrate api || true
  back_out
fi

log "Waiting for health checks"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until healthy; do
  if [ $SECONDS -ge $deadline ]; then
    "${COMPOSE[@]}" logs --tail=50 api web || true
    back_out
  fi
  sleep 3
done

echo "$target" > "$STATE/current"
echo "$target" >> "$STATE/history"
log "Healthy. $target is live."

# Keep the images of the last $KEEP_IMAGES deployed versions for fast rollbacks.
keep="$(tail -n "$KEEP_IMAGES" "$STATE/history" | cut -c1-12 | sort -u)"
for repo in refract-api refract-web; do
  docker image ls "$repo" --format '{{.Tag}}' | while read -r tag; do
    if [ "$tag" != "latest" ] && ! grep -qx "$tag" <<<"$keep"; then
      docker image rm "$repo:$tag" >/dev/null 2>&1 || true
    fi
  done
done
docker image prune -f >/dev/null
