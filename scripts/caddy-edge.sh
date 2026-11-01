#!/usr/bin/env bash
# Caddy edge helpers. Sourced by scripts/deploy.sh after `compose()` exists.
# Neighbor site blocks live on the VPS at $REPO_ROOT/Caddyfile.neighbors
# (gitignored). Extra docker networks are listed in $REPO_ROOT/caddy-extra-networks.

neighbors_file() {
  echo "${REPO_ROOT}/Caddyfile.neighbors"
}

extra_nets_file() {
  echo "${REPO_ROOT}/caddy-extra-networks"
}

caddy_container() {
  echo "${COMPOSE_PROJECT:-erp71}-caddy-1"
}

neighbors_has_site_block() {
  local f="$1"
  grep -Eq '^[a-zA-Z0-9._-]+(,[ \t]*[a-zA-Z0-9._-]+)*[ \t]*\{' "$f"
}

neighbors_restore_hint() {
  echo "Restore from /root/caddy-cutover-*-neighbors.bak and re-run. Do not write a stub." >&2
}

ensure_neighbors_file() {
  local f
  f="$(neighbors_file)"
  if [ -d "$f" ]; then
    echo "ERROR: $f is a directory. Docker creates that when the bind mount is missing." >&2
    neighbors_restore_hint
    exit 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: $f is missing. Neighbor site blocks are required now that Caddy is the public edge." >&2
    neighbors_restore_hint
    exit 1
  fi
  if ! neighbors_has_site_block "$f"; then
    echo "ERROR: $f has no site blocks (comment-only stub or empty). Reloading would drop JobXprss / Scrum71 / yt2mp3 / profiles." >&2
    neighbors_restore_hint
    exit 1
  fi
}

attach_caddy_extra_networks() {
  local f container net err
  f="$(extra_nets_file)"
  container="$(caddy_container)"
  if [ ! -f "$f" ]; then
    echo "WARN: $f missing; skipping extra network attach. Neighbor apps may 502 until the file exists." >&2
    return 0
  fi
  while IFS= read -r net || [ -n "$net" ]; do
    case "$net" in
      ''|'#'*) continue ;;
    esac
    if ! docker network inspect "$net" >/dev/null 2>&1; then
      echo "WARN: extra network $net missing; not attaching to $container" >&2
      continue
    fi
    if err="$(docker network connect "$net" "$container" 2>&1)"; then
      echo "==> Attached $container to $net"
    else
      case "$err" in
        *already\ exists*|*already\ connected*)
          echo "==> $container already on $net"
          ;;
        *)
          echo "WARN: could not attach $container to $net: $err" >&2
          ;;
      esac
    fi
  done < "$f"
}

caddy_mount_matches() {
  local container_path="$1" host_path="$2"
  docker exec "$(caddy_container)" cat "$container_path" | cmp -s - "$host_path"
}

wait_caddy_running() {
  local container timeout="${CADDY_READY_TIMEOUT:-30}" waited=0 status
  container="$(caddy_container)"
  while [ "$waited" -lt "$timeout" ]; do
    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo gone)"
    if [ "$status" = running ] \
      && docker port "$container" 80 >/dev/null 2>&1 \
      && docker port "$container" 443 >/dev/null 2>&1; then
      echo "==> $container running on 80/443 after ${waited}s"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "ERROR: $container is '${status:-gone}' after ${timeout}s (80/443 not published)." >&2
  return 1
}

validate_host_caddyfiles() {
  docker run --rm \
    -v "${REPO_ROOT}/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "${REPO_ROOT}/Caddyfile.neighbors:/etc/caddy/Caddyfile.neighbors:ro" \
    caddy:2.9-alpine \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
}

sync_caddy_config() {
  local container stale=0
  ensure_neighbors_file
  container="$(caddy_container)"
  if ! caddy_mount_matches /etc/caddy/Caddyfile "${REPO_ROOT}/Caddyfile"; then
    echo "==> Caddyfile bind mount is stale (inode changed)"
    stale=1
  fi
  if ! caddy_mount_matches /etc/caddy/Caddyfile.neighbors "${REPO_ROOT}/Caddyfile.neighbors"; then
    echo "==> Caddyfile.neighbors bind mount is stale (inode changed)"
    stale=1
  fi
  if [ "$stale" -eq 1 ]; then
    echo "==> Validating host Caddyfile + neighbors in a one-off container"
    if ! validate_host_caddyfiles; then
      echo "ERROR: caddy validate failed on host files. Not recreating Caddy." >&2
      exit 1
    fi
    echo "==> Recreating caddy to pick up new bind-mount inodes"
    compose up -d --force-recreate caddy
    wait_caddy_running || exit 1
    attach_caddy_extra_networks
    return 0
  fi
  echo "==> Reloading Caddy (bind mounts match host files)"
  if ! docker exec "$container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "ERROR: caddy validate failed inside $container. Not reloading." >&2
    exit 1
  fi
  if ! docker exec "$container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "ERROR: caddy reload failed. Previous config is still in memory." >&2
    exit 1
  fi
}
