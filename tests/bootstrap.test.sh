#!/usr/bin/env bash
# Run only inside a disposable Linux container with /work mounted read-only.
# External commands are mocked; no engine socket or real services are used.
set -Eeuo pipefail
[[ -f /.dockerenv && -f /work/public/scripts/mumble.sh && $EUID == 0 ]] || {
  echo 'Use the documented disposable Docker test command.' >&2; exit 1;
}
mkdir -p /tmp/fixture-bin
export PATH="/tmp/fixture-bin:$PATH"
export CALLS=/tmp/bootstrap-calls
: > "$CALLS"
cat > /tmp/fixture-bin/docker <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
  'context inspect --format {{.Endpoints.docker.Host}}') echo "${TEST_CONTEXT:-unix:///var/run/docker.sock}" ;;
  'ps -aq --filter label=com.docker.compose.project=strife-mumble') printf '%s' "${TEST_PROJECT:-}" ;;
  pull*) [[ ${TEST_PULL_FAIL:-no} != yes ]] ;;
esac
MOCK
cat > /tmp/fixture-bin/ss <<'MOCK'
#!/usr/bin/env bash
printf '%s' "${TEST_BUSY:-}"
MOCK
cat > /tmp/fixture-bin/openssl <<'MOCK'
#!/usr/bin/env bash
if [[ $1 == rand ]]; then
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  echo
else
  [[ ${TEST_TLS_FAIL:-no} != yes ]]
fi
MOCK
cat > /tmp/fixture-bin/sleep <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat > /tmp/fixture-bin/getenforce <<'MOCK'
#!/usr/bin/env bash
echo Enforcing
MOCK
cat > /tmp/fixture-bin/curl <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  *'/api/health') printf '%s' "${TEST_HTTP:-200}" ;;
  *'/internal'|*'/internal/') printf '%s' "${TEST_INTERNAL:-404}" ;;
  *) echo 'Unexpected network request in fixture' >&2; exit 1 ;;
esac
MOCK
cat > /tmp/fixture-bin/getent <<'MOCK'
#!/usr/bin/env bash
echo '203.0.113.10 STREAM example.test'
MOCK
chmod +x /tmp/fixture-bin/*
fail() { echo "FAIL: $*" >&2; exit 1; }
reject() {
  if "$@" >/tmp/rejected-output 2>&1; then fail "unexpected success: $*"; fi
}
for script in /work/public/scripts/*.sh; do
  bash -n "$script"
  bash "$script" --help >/dev/null
  reject bash "$script" --unknown
done
[[ ! -e /opt/strife-mumble && ! -s $CALLS ]] || fail 'help/invalid arguments performed installation'

reject env TEST_BUSY=occupied bash /work/public/scripts/mumble.sh
reject env TEST_PROJECT=existing bash /work/public/scripts/mumble.sh
reject env TEST_CONTEXT=ssh://remote bash /work/public/scripts/mumble.sh
reject env DOCKER_HOST=tcp://remote:2375 bash /work/public/scripts/mumble.sh
reject env TEST_PULL_FAIL=yes bash /work/public/scripts/mumble.sh
[[ ! -e /opt/strife-mumble ]] || fail 'preflight/pull failure wrote install files'

# Execute exactly as a downloaded pipe would execute, with no terminal input.
cat /work/public/scripts/mumble.sh | bash > /tmp/installed-output
[[ $(stat -c %a /opt/strife-mumble) == 700 ]] || fail 'directory permissions'
[[ $(stat -c %a /opt/strife-mumble/mumble.env) == 600 ]] || fail 'credential permissions'
[[ $(wc -l < /opt/strife-mumble/mumble.env) == 2 ]] || fail 'credential count'
while IFS='=' read -r key password; do
  [[ $key == MUMBLE_SUPERUSER_PASSWORD || $key == MUMBLE_CONFIG_SERVER_PASSWORD ]] || fail 'credential key'
  [[ $password =~ ^[a-f0-9]{48}$ ]] || fail 'credential format'
  if grep -q "$password" /tmp/installed-output; then fail 'credential printed'; fi
done < /opt/strife-mumble/mumble.env
grep -q '64738:64738/tcp' /opt/strife-mumble/compose.yaml || fail 'TCP mapping'
grep -q '64738:64738/udp' /opt/strife-mumble/compose.yaml || fail 'UDP mapping'
grep -q './data:/data:Z' /opt/strife-mumble/compose.yaml || fail 'SELinux mapping'
before=$(sha256sum /opt/strife-mumble/mumble.env)
reject bash /work/public/scripts/mumble.sh
[[ $(sha256sum /opt/strife-mumble/mumble.env) == "$before" ]] || fail 'rerun changed credentials'
mv /opt/strife-mumble /opt/saved-success

reject env TEST_TLS_FAIL=yes bash /work/public/scripts/mumble.sh
[[ -f /opt/strife-mumble/mumble.env ]] || fail 'failed readiness lost recoverable data'
grep -q 'retained' /tmp/rejected-output || fail 'no recovery instructions'

# Ubuntu 24.04 is deliberately outside the Helltube launcher's contract.
reject bash /work/public/scripts/helltube.sh
grep -q 'Ubuntu 26.04' /tmp/rejected-output || fail 'OS guard'
cp /etc/os-release /tmp/original-os-release
printf 'ID=ubuntu\nVERSION_ID=26.04\n' > /etc/os-release
mkdir -p /run/systemd/system
printf '#!/usr/bin/env bash\nexit 0\n' > /tmp/fixture-bin/systemctl
chmod +x /tmp/fixture-bin/systemctl
reject bash /work/public/scripts/helltube.sh
grep -q 'interactive SSH terminal' /tmp/rejected-output || fail 'terminal guard'
# A real pseudo-terminal exercises the pipe-to-/dev/tty handoff. A corrupt
# archive must fail its checksum before tar or any upstream code can execute.
mkdir -p /etc/ssl/certs
printf 'fixture CA bundle\n' > /etc/ssl/certs/ca-certificates.crt
cat > /tmp/fixture-bin/curl <<'MOCK'
#!/usr/bin/env bash
if [[ $* == *codeload.github.com* ]]; then
  printf 'deliberately corrupt archive\n' > "${@: -1}"
  exit 0
fi
case "$*" in
  *'/api/health') printf '%s' "${TEST_HTTP:-200}" ;;
  *'/internal'|*'/internal/') printf '%s' "${TEST_INTERNAL:-404}" ;;
  *) exit 1 ;;
esac
MOCK
cat > /tmp/fixture-bin/tar <<'MOCK'
#!/usr/bin/env bash
touch /tmp/unverified-extraction
exit 1
MOCK
chmod +x /tmp/fixture-bin/tar
reject script --quiet --return --command 'cat /work/public/scripts/helltube.sh | bash' /dev/null
[[ ! -e /tmp/unverified-extraction ]] || fail 'unverified source extracted'
compgen -G '/tmp/strife-helltube.*' >/dev/null && fail 'temporary source not cleaned after checksum failure'
cp /tmp/original-os-release /etc/os-release

bash /work/public/scripts/doctor.sh voice.example.com watch.example.com > /tmp/doctor-output
grep -q 'PASS: /api/health' /tmp/doctor-output || fail 'doctor health probe'
reject env TEST_HTTP=503 bash /work/public/scripts/doctor.sh voice.example.com watch.example.com
reject env TEST_INTERNAL=200 bash /work/public/scripts/doctor.sh voice.example.com watch.example.com
reject bash /work/public/scripts/doctor.sh 'https://wrong.example.com/path'
reject bash /work/public/scripts/doctor.sh 'host;touch /tmp/injected'
[[ ! -e /tmp/injected ]] || fail 'hostname injection'
printf '%s\n' 'PASS: pipe execution, guards, ports, secret permissions/redaction, SELinux, reruns, retained failure data, archive integrity/cleanup, diagnostics.'
