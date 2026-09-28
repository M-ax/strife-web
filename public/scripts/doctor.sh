#!/usr/bin/env bash
# Read-only checks. Does not print environment files, passwords or service logs.
set -Eeuo pipefail

main() {
  if [[ ${1:-} == --help ]]; then
    printf '%s\n' 'Usage: bash doctor.sh [voice.example.com [watch.example.com]]' \
      'Linux/macOS. Checks DNS, Mumble TLS, HTTPS health, and the /internal block.' \
      'No root needed. Cannot prove UDP reachability or successful media playback.'
    return
  fi
  [[ $# -le 2 ]] || { echo 'Too many arguments. Use --help.' >&2; return 1; }
  local host
  for host in "$@"; do
    [[ ${#host} -le 253 && $host =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && $host != *..* ]] || {
      echo 'Supply hostnames only (no scheme, path, port or credentials).' >&2; return 1;
    }
  done
  local failures=0
  printf 'System: %s\n' "$(uname -sm)"
  if command -v ss >/dev/null; then
    printf '\nRelevant local listeners (empty is normal on a client machine):\n'
    ss -H -lntu '( sport = :3000 or sport = :64738 or sport = :443 or sport = :44444 )'
  fi
  for host in "$@"; do
    printf '\nDNS for %s:\n' "$host"
    if command -v getent >/dev/null; then
      getent ahosts "$host" || { echo 'FAIL: no DNS result'; failures=$((failures + 1)); }
    elif command -v dscacheutil >/dev/null; then
      dscacheutil -q host -a name "$host"
    else
      echo 'SKIP: no supported DNS lookup tool'
    fi
  done
  if [[ -n ${1:-} ]]; then
    local timer
    timer=$(command -v timeout || command -v gtimeout || true)
    if command -v openssl >/dev/null && [[ -n $timer ]]; then
      if "$timer" 10 openssl s_client -connect "$1:64738" -servername "$1" </dev/null >/dev/null 2>&1; then
        echo 'PASS: Mumble TCP/TLS reachable (certificate trust and UDP still need client testing)'
      else
        echo 'FAIL: Mumble TCP/TLS unreachable'; failures=$((failures + 1))
      fi
    else
      echo 'SKIP: Mumble probe needs openssl and timeout (brew install coreutils on macOS)'
    fi
  fi
  if [[ -n ${2:-} ]]; then
    command -v curl >/dev/null || { echo 'curl is required for HTTPS checks.' >&2; return 1; }
    local status path expected
    for path in /api/health /internal /internal/; do
      expected=200
      [[ $path == /api/health ]] || expected=404
      status=$(curl --silent --show-error --proto '=https' --connect-timeout 5 --max-time 15 \
        --output /dev/null --write-out '%{http_code}' "https://$2$path") || status=000
      if [[ $status == "$expected" ]]; then
        printf 'PASS: %s returned %s\n' "$path" "$status"
      else
        printf 'FAIL: %s returned %s (expected %s)\n' "$path" "$status" "$expected"
        failures=$((failures + 1))
      fi
    done
  fi
  echo 'Finish with two clients on different networks: voice, chat, login, upload, playback, screen share.'
  [[ $failures == 0 ]]
}

main "$@"
