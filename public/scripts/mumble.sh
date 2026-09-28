#!/usr/bin/env bash
# Strife Mumble bootstrap v1. Requires Docker Engine + Compose v2 on Linux.
# Usage: curl -fsSL https://strife.zip/scripts/mumble.sh | sudo bash
set +x
set -Eeuo pipefail
umask 077

main() {
  if [[ ${1:-} == --help ]]; then
    printf '%s\n' 'Usage: sudo bash mumble.sh [--help]' \
      'Creates /opt/strife-mumble; publishes TCP/UDP 64738 on all interfaces.' \
      'Requires Linux, Docker Engine and Compose v2. Refuses existing installs.' \
      'No firewall, SSH, DNS or existing service settings are changed.'
    return
  fi
  [[ $# == 0 ]] || { echo 'Unknown argument. Use --help.' >&2; return 1; }
  [[ $(uname -s) == Linux && $EUID == 0 ]] || {
    echo 'Run on your Linux server as root (sudo bash).' >&2; return 1;
  }
  case $(uname -m) in
    x86_64|aarch64) ;;
    *) echo 'This quick-start supports x86_64 and aarch64 only.' >&2; return 1 ;;
  esac
  local command
  for command in docker openssl ss install timeout; do
    command -v "$command" >/dev/null || { echo "Missing $command; see /wiki/#docker." >&2; return 1; }
  done
  docker info >/dev/null
  docker compose version >/dev/null
  # Never target a remote daemon with host-local bind mounts.
  [[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]] || {
    echo 'Unset DOCKER_HOST/DOCKER_CONTEXT; a local Docker daemon is required.' >&2; return 1;
  }
  [[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix://* ]] || {
    echo 'Select a local Unix-socket Docker context first.' >&2; return 1;
  }
  local directory=/opt/strife-mumble
  [[ ! -e $directory && ! -L $directory ]] || {
    echo 'Existing /opt/strife-mumble found. Nothing overwritten; see the wiki upgrade/recovery procedure.' >&2; return 1;
  }
  [[ -z $(docker ps -aq --filter label=com.docker.compose.project=strife-mumble) ]] || {
    echo 'A strife-mumble Compose project already exists. Inspect it first.' >&2; return 1;
  }
  if [[ -n $(ss -H -lntu 'sport = :64738') ]]; then
    echo 'Port 64738 is already in use. Keep or migrate your existing voice server.' >&2; return 1;
  fi
  local image='mumblevoip/mumble-server:v1.5.915@sha256:018ad3515932e513d8fdc970df918373a2664c4da32b09a89a4aaee28eb7507a'
  local volume='./data:/data'
  if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
    volume='./data:/data:Z'
  fi
  docker pull "$image"
  # mkdir (without -p) also rejects a competing installation created after preflight.
  mkdir -m 700 "$directory"
  trap 'echo "Setup stopped. Files/data are retained in /opt/strife-mumble; see /wiki/#recovery. Credentials are never regenerated on a rerun." >&2' ERR
  install -d -m 700 "$directory/data"
  printf 'MUMBLE_SUPERUSER_PASSWORD=%s\nMUMBLE_CONFIG_SERVER_PASSWORD=%s\n' \
    "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$directory/mumble.env"
  cat > "$directory/compose.yaml" <<EOF
name: strife-mumble
services:
  mumble:
    image: $image
    restart: unless-stopped
    ports:
      - "64738:64738/tcp"
      - "64738:64738/udp"
    env_file: mumble.env
    environment:
      MUMBLE_CONFIG_USERS: "50"
      MUMBLE_CONFIG_REGISTER_NAME: "Strife voice"
    volumes:
      - $volume
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
EOF
  chmod 600 "$directory/compose.yaml" "$directory/mumble.env"
  docker compose --project-directory "$directory" up -d
  # A running container alone is not a readiness check: make a real TLS connection.
  local attempt ready=no
  for ((attempt = 0; attempt < 30; attempt++)); do
    if timeout 3 openssl s_client -connect 127.0.0.1:64738 </dev/null >/dev/null 2>&1; then
      ready=yes
      break
    fi
    sleep 2
  done
  [[ $ready == yes ]] || {
    echo 'Mumble did not accept TLS within the startup window. Files/data are retained in /opt/strife-mumble; see /wiki/#recovery.' >&2
    return 1
  }
  trap - ERR
  printf '%s\n' 'Mumble is accepting local TLS connections on port 64738.' \
    'Allow TCP AND UDP 64738 in your provider firewall/NAT. Docker publishes on all interfaces.' \
    'Read passwords privately: sudo cat /opt/strife-mumble/mumble.env' \
    'Share only SERVER_PASSWORD. SUPERUSER_PASSWORD is the administrator credential.' \
    'Connect with Strife using your DNS-only voice hostname and port 64738.' \
    'Verify the server certificate and test voice from a second network: /wiki/#verify'
}

main "$@"
