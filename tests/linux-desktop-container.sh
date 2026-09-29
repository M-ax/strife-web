#!/bin/sh
# Run only in a disposable container; installs runtime and test dependencies.
set -eu
archive=${1:?Pass the trusted Linux release archive}
expected=${2:?Pass its SHA-256 from release.json}
. /etc/os-release
case "$ID" in
  arch)
    pacman -Syu --noconfirm --needed gtk3 webkit2gtk-4.1 libnotify alsa-lib \
      libsm libice libx11 libxi libxrender libxcb xcb-util-cursor xcb-util-image \
      xcb-util-keysyms xcb-util-renderutil xcb-util-wm libxkbcommon-x11 \
      libglvnd mesa icu openssl dbus xorg-server-xvfb xorg-xauth python ttf-dejavu
    ;;
  rocky)
    dnf install -y epel-release dnf-plugins-core
    dnf config-manager --set-enabled crb
    dnf install -y gtk3 webkit2gtk4.1 libnotify alsa-lib libSM libICE libX11 \
      libXi libXrender libxcb xcb-util-cursor xcb-util-image xcb-util-keysyms \
      xcb-util-renderutil xcb-util-wm libxkbcommon-x11 libglvnd-glx \
      libglvnd-opengl libglvnd-egl mesa-dri-drivers libicu openssl-libs \
      dbus-daemon dbus-tools xorg-x11-server-Xwayland weston \
      python3 dejavu-sans-fonts tar gzip
    ;;
  void)
    xbps-install -Suy
    xbps-install -Suy
    xbps-install -y gtk+3 libwebkit2gtk41 libnotify alsa-lib libSM libICE libX11 \
      libXi libXrender libxcb xcb-util-cursor xcb-util-image xcb-util-keysyms \
      xcb-util-renderutil xcb-util-wm libxkbcommon-x11 libglvnd mesa-dri icu \
      libssl3 dbus tar gzip bash shadow xorg-server-xvfb xauth python3 dejavu-fonts-ttf
    ;;
  *) echo "Unsupported smoke-test distro: $ID" >&2; exit 1 ;;
esac
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
mkdir -p /tmp/strife-package /tmp/strife-runtime /tmp/.X11-unix
chmod 700 /tmp/strife-runtime
chmod 1777 /tmp/.X11-unix
tar -xzf "$archive" -C /tmp/strife-package
export XDG_RUNTIME_DIR=/tmp/strife-runtime
if [ "$ID" = rocky ]; then
  weston --backend=headless --renderer=pixman --xwayland --socket=wayland-0 \
    --idle-time=0 >/tmp/strife-display.log 2>&1 &
  display_pid=$!
  export DISPLAY=:0 GDK_BACKEND=x11
else
  Xvfb :99 -screen 0 1480x900x24 >/tmp/strife-display.log 2>&1 &
  display_pid=$!
  export DISPLAY=:99
fi
trap 'kill "$display_pid" 2>/dev/null || true' EXIT
sleep 3
kill -0 "$display_pid"
# Test containers have no physical GPU/audio devices or browser sandbox user
# namespaces. Never carry this override into the normal desktop launch commands.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
dbus-run-session python3 /checks/linux-desktop-smoke.py /tmp/strife-package/Strife
