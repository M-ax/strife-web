#!/usr/bin/env bash
# Strife Helltube launcher v1. Ubuntu 26.04 + systemd + interactive SSH terminal.
# The complete upstream checkout is pinned and verified before its installer runs.
set +x
set -Eeuo pipefail
umask 077

main() {
  if [[ ${1:-} == --help ]]; then
    printf '%s\n' 'Usage: curl -fsSL https://strife.zip/scripts/helltube.sh | sudo bash' \
      'Ubuntu 26.04, x86_64/aarch64, systemd and a controlling terminal required.' \
      'Prepare a DNS-only hostname, ACME email and a scoped Cloudflare DNS token.' \
      'Runs the pinned upstream interactive installer, including nginx and TLS.' \
      'Managed Helltube configuration is replaced on reruns; data is preserved.' \
      'Installs curl/CA certificates if missing. Does not change DNS or firewalls.'
    return
  fi
  [[ $# == 0 ]] || { echo 'Unknown argument. Use --help.' >&2; return 1; }
  [[ $(uname -s) == Linux && $EUID == 0 ]] || {
    echo 'Run on your Linux server as root (sudo bash).' >&2; return 1;
  }
  # shellcheck source=/dev/null
  source /etc/os-release
  [[ $ID == ubuntu && $VERSION_ID == 26.04 ]] || {
    echo 'The upstream installer requires Ubuntu 26.04. Other OS: https://strife.zip/wiki/#manual-helltube' >&2; return 1;
  }
  case $(uname -m) in
    x86_64|aarch64) ;;
    *) echo 'Supported architectures: x86_64 and aarch64.' >&2; return 1 ;;
  esac
  [[ -d /run/systemd/system ]] || { echo 'A running systemd instance is required.' >&2; return 1; }
  systemctl show-environment >/dev/null
  # The pipe carries this script; interactive answers use the controlling terminal.
  if ! { exec 3<>/dev/tty; } 2>/dev/null; then
    echo 'An interactive SSH terminal is required. Connect with ssh -t, then rerun.' >&2; return 1;
  fi
  command -v curl >/dev/null && [[ -s /etc/ssl/certs/ca-certificates.crt ]] || {
    apt-get update
    apt-get install -y ca-certificates curl
  }
  local revision=b8edab6a0faca32fdddadc1ccfbba74444f7d8bf
  local checksum=c17e3e90309fb1843d331d2bd43dc6e68e33a464c114fe5bb0289fc3310efc38
  # This variable must outlive main: EXIT runs after function locals disappear.
  strife_helltube_work=$(mktemp -d /tmp/strife-helltube.XXXXXXXX)
  readonly strife_helltube_work
  # Only remove the private directory created by this invocation.
  trap 'rm -rf -- "$strife_helltube_work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
    --connect-timeout 20 --max-time 600 --retry 3 \
    "https://codeload.github.com/M-ax/helltube/tar.gz/$revision" -o "$strife_helltube_work/source.tar.gz"
  if ! printf '%s  %s\n' "$checksum" "$strife_helltube_work/source.tar.gz" | sha256sum --check --status; then
    echo 'Helltube archive checksum mismatch; no upstream code executed.' >&2
    return 1
  fi
  tar -xzf "$strife_helltube_work/source.tar.gz" -C "$strife_helltube_work" --no-same-owner
  cd "$strife_helltube_work/helltube-$revision"
  printf 'Verified Helltube %s. Starting the upstream interactive installer.\n' "$revision"
  # Upstream requires stdin to be a terminal. Its prompts never consume script bytes.
  HELLTUBE_COMMIT="$revision" bash scripts/bootstrap-ubuntu.sh <&3
  cd /
  rm -rf -- "$strife_helltube_work"
  trap - EXIT
  printf '%s\n' 'Next: configure public desktop media if needed: https://strife.zip/wiki/#screen-sharing' \
    'Back up /var/lib/helltube and /etc/helltube before any later deployment.'
}

main "$@"
