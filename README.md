# strife-web

Landing and download page for **Strife**, served by a Cloudflare Worker at **https://strife.zip**.

## Getting started wiki and server scripts

The public [getting-started wiki](https://strife.zip/wiki/) covers VPS selection, OS trade-offs, SSH, DNS/firewalls, Mumble, Helltube, Caddy/nginx, WebRTC, desktop installation, backups, upgrades, and recovery. Its static source is [public/wiki/index.html](public/wiki/index.html); it remains readable without JavaScript. The landing navigation and FAQ link to it.

The [script download page](https://strife.zip/scripts/) includes copyable curl-to-Bash commands, requirements and side effects, source links, downloads, and SHA-256 checksums:

- `mumble.sh`: fresh Linux Docker/Compose installation, pinned official image, private generated credentials and persistent data. Refuses existing installs; Docker/Compose must already be installed.
- `helltube.sh`: Ubuntu 26.04/systemd launcher for the complete checksum-verified upstream checkout at `b8edab6a0faca32fdddadc1ccfbba74444f7d8bf`. Requires a controlling terminal and Cloudflare DNS credentials. Prompts use `/dev/tty`; the pipe carries only script code.
- `doctor.sh`: read-only listener/DNS/TLS/HTTP diagnostics. No root required.

After changing a public shell script, run `npm run scripts:checksums`; the build rejects stale checksums or CRLF shell scripts. Downloads are static text assets under `public/scripts`, with LF enforced by `.gitattributes`. Do not run the installation scripts on the development host.

Validate installation boundaries using a disposable container (no Docker socket, production credentials or host-system directories are mounted):

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/work,readonly" ubuntu:24.04 bash /work/tests/bootstrap.test.sh
```

On Linux/macOS replace the mount argument with `"type=bind,source=$PWD,target=/work,readonly"`. This fixture mocks external services and checks pipe execution, preflight refusals, file/secret permissions, port mappings, SELinux labeling, rerun preservation, failure recovery, corrupt-source rejection/cleanup, and diagnostic failures. It does not perform a real Helltube deployment. `npm run test:mumble` pulls the pinned official image and tests real TCP/TLS and UDP in a disposable container on random loopback-only ports, then removes it. With the local web server running, `npm run test:docs` checks the wiki/download pages, responsive layout, WCAG, clipboard, links, no-JS access, script bytes/checksums and real download responses. Production DNS/TLS, OS provisioning, and media acceptance tests require a disposable live host.

The site uses static HTML/CSS, self-hosted fonts, and a small JavaScript enhancement. The Worker streams Windows, Linux, and macOS downloads from the private R2 bucket **strife-releases**, bound as **RELEASES** in wrangler.jsonc. No production credentials are committed.

The website theme, logos, and social card use Strife teal (`#00E0BB`), matching the app. The landing page and wiki describe preview.9's clearer voice statuses, stronger self identification, and compact panel headers, alongside existing appearance settings, installed-font discovery, an HSV color picker, chat styling, and fixed user controls sizing. Platform requirements and signing status are unchanged.

The wiki also covers Arch, Rocky 10 (EPEL/CRB), and Void glibc for desktop installation and manual hosting, including runit on Void. All three use the existing Linux tarball; this documentation expansion does not change release metadata or create duplicate packages. Rocky 8/9 and Void musl are outside the desktop binary's glibc 2.38+ compatibility target. See [Linux validation](docs/linux-validation.md) for the tested environments and the limits of container checks.

## Local development

Use Node.js 24 or newer:

    npm ci
    npm run release:local
    npm run dev

Open http://localhost:4317. Local seeding requires the archives described in release.json in the gitignored releases directory. Unavailable packages fall back to a source link independently; a missing Mac build does not hide the Windows or Linux downloads.

## Prepare a release

### Desktop/media release notes

Preview.10 retains preview.9's accent rail, tinted row, and filled avatar for the logged-in
user instead of a YOU badge. Separate subdued microphone-off and headphones-off
icons show muted and deafened states, including both together; user-panel
buttons use the same bundled font. Panel drag grips have tighter leading
spacing, and vertical collapsed panels put expand and position options below
the name.

The release retains preview.8's fix for the reported Windows Xbox Wireless controller shutoff on input
after reconnecting while Strife is running. The landing page and wiki explain
that controller shortcuts remain enabled, the complete native engine must be
updated, and older Mumble/Strife instances should be closed when retesting.
No Windows input-driver bypass or controller firmware change is required.

The release retains preview.7's per-user Windows installation and authenticated OTA updates, plus the chat image viewer, dockable Downloads panel, dedicated Helltube embed controls, and negotiated direct-to-metal HLS playback. Windows installed builds download updates quietly; the Update button installs and restarts, while ordinary exit installs without relaunching. Older installs require one manual migration. Portable, Linux and macOS packages remain manual-update only. Direct playback still requires matching Helltube assets, and the native streaming helper is not bundled.

The experimental Windows native OBS sharing helper is **not included** by the normal Strife publish script. Keep browser sharing instructions and do not advertise the helper as shipping. OS requirements, Windows unsigned status, and macOS ad-hoc signing/notarization limitations are unchanged. Windows runtime distribution changes are described below.

Preview.10 introduces a smaller online
installer that fetches missing Microsoft prerequisites, and installer/OTA packages
are framework-dependent on .NET 10. Both **.NET Runtime** and **ASP.NET Core
Runtime**, Windows x64, are required for those builds, not the SDK or Hosting
Bundle. Setup bundles the app and native voice engine. Portable remains self-contained with .NET and the native voice engine;
WebView2 and Visual C++ remain external prerequisites. The landing download
section and getting-started wiki provide official Microsoft links for
[WebView2 Evergreen standalone x64](https://go.microsoft.com/fwlink/?linkid=2124701),
[Visual C++ x64](https://aka.ms/vs/17/release/vc_redist.x64.exe), and the
[.NET 10 runtime download page](https://dotnet.microsoft.com/en-us/download/dotnet/10.0).
Setup downloads prerequisites only when missing or incompatible, using pinned
Microsoft URLs and SHA-256 hashes verified before execution. Downloads need
internet access; there is no separate offline installer. .NET and Visual C++
installation may request administrator approval; run Setup normally as the
intended user. Signed schema 2 feeds declare `dotNetFrameworks`; existing users,
including updater-capable installations, must run the new Setup manually once.
Installers through preview.9 bundled WebView2/Visual C++ prerequisites and .NET.
Keep
`release.json`, `updates.json`, filenames, version, and source revision unchanged
until actual new packages are qualified and imported.

The landing FAQ and wiki's `#native-sharing-development` subsection separately describe source-development work: local previews/thumbnails, audio meters, Automatic/Manual application audio, custom quality through 4K60 40 Mbps, no-upscale output, and locally probed hardware encoding. Default quality is 1080p60 8 Mbps. These descriptions must not be folded into the current-download feature list until actual qualified packages contain the helper. A Windows-only portable development build does not justify changing `release.json`, its source ref, platform support claims, or signing notes.

GitHub Actions supplies the existing four native app-build runners and installs Inno Setup for Windows packaging. That does not implement the missing macOS/Linux streaming helpers or complete their permission, portal, signing, hardware, and distribution-source validation. The normal workflow continues to omit the helper. Keep the advertised package manifest unchanged for source-only updates; a full release still requires all five actual packages, R2 upload, website deployment, and production verification.

The preview.10 packages were built and validated from exact Strife source commit
`8cbe5d1debc5ab7d6f5472597a25cb9e97696410` in
[Publish run 39031125429](https://github.com/M-ax/strife/actions/runs/39031125429).
All four targets reused the unchanged compiled Mumble cache,
including the Xbox reconnect backport, without recompiling native code.
Managed/web tests and package/startup checks passed on all four targets. Windows
also passed standard-user installation, upgrade, installed framework-dependent
app startup, uninstall and OTA checks, and produced signed schema 2 update metadata.
The downloaded packages match CI checksums. The Windows installer is 56,482,065
bytes, compared with preview.9's 343,478,873 bytes; the portable ZIP retains .NET.
No new Arch, Rocky, or Void
distro-specific validation is claimed; the historical evidence and limits in
[Linux validation](docs/linux-validation.md) still apply. Helltube's bootstrap
source/hash pin remains separate.

Build and test the app on each native target using the neighboring Strife repository's release scripts. Collect these five packages in one directory:

- Strife-VERSION-win-x64-Setup.exe — Windows x64 online installer; bundles app/voice and downloads missing or incompatible WebView2, Visual C++, .NET and ASP.NET Core x64 runtimes.
- Strife-VERSION-win-x64.zip — Windows portable archive; .NET and voice are included, while WebView2 and Visual C++ must already be installed.
- Strife-VERSION-linux-x64.tar.gz — Ubuntu 24.04 x64 baseline; GTK 3, WebKitGTK 4.1, and audio/X11 runtime libraries required.
- Strife-VERSION-osx-arm64.zip — macOS 14+ Apple Silicon app.
- Strife-VERSION-osx-x64.zip — macOS 14+ Intel app.

Import the complete set without repacking the native archives:

    node scripts/import-release.mjs ../strife/artifacts/release 0.1.0-preview.10 8cbe5d1debc5ab7d6f5472597a25cb9e97696410

PowerShell callers can also use:

    ./scripts/package-release.ps1 -SourceDirectory ../strife/artifacts/release -Version 0.1.0-preview.10 -SourceRef 8cbe5d1debc5ab7d6f5472597a25cb9e97696410

The importer checks all five packages, copies them to releases, and writes per-file sizes and SHA-256 hashes to release.json and adjacent checksum files. Existing versioned files with different bytes are rejected. Choose a new version for every new build: R2 keys are immutable release locations of the form releases/VERSION/FILENAME, so resuming a download cannot mix builds.

For updater-capable Windows releases, also collect `Strife-VERSION-full.nupkg`
and the signed `windows-preview.json` (or `windows-stable.json`) from the same
workflow, then run:

    node scripts/import-update.mjs ARTIFACT_DIRECTORY

This verifies the client-pinned RSA-PSS signature, package size/hash, version and
exact source commit before updating `updates.json`. The Worker serves unchanged
signed envelopes under `/updates/windows-CHANNEL.json` and full packages under
`/updates/packages/FILENAME`. `release:upload` uploads the OTA package along with
the five public downloads; `release:verify` checks all six and the signed feed.
Upload before deploying. The installer remains unsigned in the Windows
Authenticode sense; authenticated OTA metadata is a separate protection.

Feeds expire after 30 days. Renew metadata using the Strife signing workflow
and the same immutable bytes/source revision, import it and deploy before expiry.
Never put the private signing key in this repository. Key rotation requires a
client transition release signed by an existing trusted key.

Remote uploads use 8 MiB R2 multipart parts, avoiding Wrangler's 300 MiB
single-upload limit and large-request gateway timeouts. The uploader creates an
authenticated temporary Worker restricted to one exact package key, supplies a
random capability through Cloudflare's secret store, and deletes that Worker in
`finally`. Its capability expires after 30 minutes even if the uploader is
interrupted. No S3 key or upload secret is stored in this repository. Existing
objects are reused only when their size/hash match; mismatches are never
overwritten. If cleanup reports a Worker name, remove that temporary Worker in
Cloudflare before retrying.

Supply the Strife commit, tag, or branch used to build the packages as `SOURCE_REF` (`-SourceRef` in PowerShell); prefer an immutable commit or release tag. New versions require it. Reimporting the same version preserves the existing source ref when omitted. The importer records it in `release.json` and updates the website's marked build references, including wiki versions, command filenames, and source-documentation links.

### Refresh website and wiki references

`release.json` is the single source for the advertised build. After editing it directly, run:

    npm run release:docs
    npm run release:docs:check

The first command refreshes all marked references in HTML beneath `public/`, including nested wiki pages. The second checks without writing; stale or unmarked references fail `npm run check`, builds, and the `npm run deploy` preflight. Both commands work offline and require no release archives. Commit the manifest and updated HTML together. See [AGENTS.md](AGENTS.md) for the marker syntax when adding pages or examples.

Review platform requirements, signing status, and setup instructions against the chosen build separately. The updater leaves other software versions and the wiki's **Last reviewed** date alone; changing filenames does not certify the instructions for a new release. It does not verify that a source ref exists upstream, upload archives, or deploy the site.

The Windows installer is unsigned. macOS builds are ad-hoc signed and not notarized; downloaded builds may need approval in Privacy & Security. These limitations are shown on the download cards.

## Check and publish

    npm run build
    npm test
    npm run release:local
    npm run dev

With the development server running:

    npm run test:browser

The build checks TypeScript, script checksums, and release-reference freshness, then runs a Wrangler deployment dry run. Unit tests cover release-reference updates/imports, per-platform availability, headers, checksums, cache validators, byte ranges, and object replacement/failure handling. Browser tests cover desktop/mobile layout, keyboard controls, WCAG A/AA, clipboard, a complete portable ZIP hash check, and each platform's real download routes. They use installed Chrome; STRIFE_TEST_BROWSER=msedge selects Edge. STRIFE_WEB_URL overrides the local test URL.

To publish, authenticate with `npx wrangler login`. The existing bucket is **strife-releases**; a new account would need `npx wrangler r2 bucket create strife-releases` once.

    npm run release:upload
    npm run build
    npm test
    npm run deploy

**Upload before deploying metadata.** The uploader verifies every local file's size and hash before sending any objects to R2. Remote upload and deployment modify Cloudflare. The Worker declares strife.zip as a Custom Domain; workers.dev and preview URLs are disabled.

After deployment, check https://strife.zip/api/release: every downloads entry should have available: true. Run `npm run release:verify` to download every package and verify its complete SHA-256, size, headers, checksum file, and byte-range support. Pass a local origin with `npm run release:verify -- http://127.0.0.1:4317` for local verification. For CI, supply CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN through the CI secret store with Worker deployment and R2 permissions.

## Files and routes

- public/index.html, public/style.css, public/app.js: landing page, responsive download cards, preview controls, and checksums.
- GET /wiki/: complete getting-started guide with static contents and copyable commands.
- GET /scripts/: bootstrap download page; shell scripts and SHA256SUMS live beneath this route.
- src/worker.ts: catalog API and streamed R2 downloads.
- release.json: version, date, and an array of download metadata.
- GET or HEAD /api/release: catalog with independent R2 availability for every package.
- GET or HEAD /download/windows-x64: Windows setup executable.
- GET or HEAD /download/windows-x64-portable: Windows portable ZIP.
- GET or HEAD /download/linux-x64: Linux tar.gz.
- GET or HEAD /download/macos-arm64: Apple Silicon app ZIP.
- GET or HEAD /download/macos-x64: Intel app ZIP.
- Append .sha256 to any download route for its checksum file.
- Unknown paths return a real 404.

Downloads support byte ranges, ETag validation, and HEAD requests. Only manifest-listed routes can select objects; arbitrary bucket keys and remote URLs are not accepted. The static page retains direct platform links without JavaScript.

## Assets

Barlow Condensed and DM Sans are self-hosted under their SIL Open Font Licenses. Refresh them with `npm run fonts`. The logo, favicon, illustration, and social image are original SVG/CSS artwork. Regenerate the social PNG with `node scripts/render-social.mjs`.

The illustration's voice-status icons use Strife's unmodified 864-byte Symbols Nerd Font subset, self-hosted as `public/fonts/strife-voice.woff2`. Its full MIT/Apache licenses and subset notice are in `public/fonts/strife-voice-LICENSE.txt`, copied from the same Strife source revision.

The illustrated interface uses sample conversations and an original fictional movie poster and is labeled as an illustration. Source and issue links point to https://github.com/M-ax/strife.
