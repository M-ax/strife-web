# Linux desktop validation

The published `0.1.0-preview.4` Linux archive is reused unchanged for Ubuntu 24.04, Arch x86_64, Rocky 10 x86_64 (EPEL + CRB), and Void x86_64 glibc. It contains the managed runtime and pinned Mumble payload; host packages supply GTK 3, WebKitGTK 4.1, audio, graphics, and X11/Xwayland. No distro-specific repack is needed for these targets.

The ELF version requirements reach **GLIBC_2.38**. Rocky 8/9 and Void musl are outside this binary's compatibility range. A different package extension cannot fix a different libc ABI. No native musl or ARM desktop package is advertised.

## Checked environments

Checked on 28 September 2026 against the actual published archive and distro repositories:

| Environment    | Container image digest                                                                                         | Display used               |
| -------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Arch Linux     | `archlinux:base@sha256:b21322c663be387c0ed9cbc7bbbfe18e41633ad4e7b7c77cfad45f128be20040`                       | Xvfb                       |
| Rocky Linux 10 | `rockylinux/rockylinux:10@sha256:827d37bc128288ccf160ee318bb3cb92d591164cb217e92f8bc61e3982ae1834`             | Weston headless + Xwayland |
| Void glibc     | `ghcr.io/void-linux/void-glibc:latest@sha256:c0270a1b5b78d397bb4b53d09266eed1f435cc2f56638b44ede57fea29dc476e` | Xvfb + Mesa                |

All three passed library resolution, authenticated native transport, RNNoise presence, PTT configuration, mute commands, clean native shutdown, and packaged desktop bootstrap (the local UI responds and WebKit starts the voice child). Tests select the PulseAudio backend without transmitting audio; auto-selecting an unavailable JACK server is not a useful hardware test in a container. Mesa is necessary for WebKit's software graphics path on Void.

These checks do **not** certify microphone/speaker quality, physical GPU drivers, Wayland global shortcuts, screen sharing, codec playback, or permissions in real user sessions. The harness disables WebKit's sandbox only inside the disposable test container; normal user instructions must never set that override. Manual Helltube/Docker/runit documentation has not been certified as a live public deployment on every distro. Real TLS, firewall, media, backup, and reboot checks remain required on the operator's host.

## Reproduce

Use Docker with Linux containers, the existing archives in `releases/`, and the current manifest. From this repository in PowerShell:

```powershell
$release = Get-Content release.json -Raw | ConvertFrom-Json
$linux = $release.downloads | Where-Object id -eq 'linux-x64'
$images = @('archlinux:base', 'rockylinux/rockylinux:10', 'ghcr.io/void-linux/void-glibc:latest')
foreach ($image in $images) {
    docker run --rm --shm-size=512m `
      --mount "type=bind,source=$($PWD.Path)/releases,target=/release,readonly" `
      --mount "type=bind,source=$($PWD.Path)/tests,target=/checks,readonly" `
      $image sh /checks/linux-desktop-container.sh "/release/$($linux.filename)" $linux.sha256
    if ($LASTEXITCODE) { throw "Linux smoke check failed: $image" }
}
```

The harness installs runtime/test packages inside each disposable container, verifies the archive SHA-256 before extracting, and runs the Python standard-library probe. It neither modifies the archive nor mounts the Docker daemon inside the container. Rolling distro dependencies change; record new image digests and revalidate before changing the published support claims.
