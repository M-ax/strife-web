# strife-web

Landing and download page for **Strife**, served by a Cloudflare Worker at **https://strife.zip**.

The site uses static HTML/CSS, self-hosted fonts, and a small JavaScript enhancement. The Worker streams Windows, Linux, and macOS downloads from the private R2 bucket **strife-releases**, bound as **RELEASES** in wrangler.jsonc. No production credentials are committed.

## Local development

Use Node.js 24 or newer:

    npm ci
    npm run release:local
    npm run dev

Open http://localhost:4317. Local seeding requires the archives described in release.json in the gitignored releases directory. Unavailable packages fall back to a source link independently; a missing Mac build does not hide the Windows or Linux downloads.

## Prepare a release

Build and test the app on each native target using the neighboring Strife repository's release scripts. Collect these five packages in one directory:

- Strife-VERSION-win-x64-Setup.exe — Windows x64 installer, including WebView2 and Visual C++ prerequisites.
- Strife-VERSION-win-x64.zip — Windows portable archive; those prerequisites must already be installed.
- Strife-VERSION-linux-x64.tar.gz — Ubuntu 24.04 x64 baseline; GTK 3, WebKitGTK 4.1, and audio/X11 runtime libraries required.
- Strife-VERSION-osx-arm64.zip — macOS 14+ Apple Silicon app.
- Strife-VERSION-osx-x64.zip — macOS 14+ Intel app.

Import the complete set without repacking the native archives:

    node scripts/import-release.mjs ../strife/artifacts/release 0.1.0-preview.2

PowerShell callers can also use:

    ./scripts/package-release.ps1 -SourceDirectory ../strife/artifacts/release -Version 0.1.0-preview.2

The importer checks all five packages, copies them to releases, and writes per-file sizes and SHA-256 hashes to release.json and adjacent checksum files. Existing versioned files with different bytes are rejected. Choose a new version for every new build: R2 keys are immutable release locations of the form releases/VERSION/FILENAME, so resuming a download cannot mix builds.

The Windows installer is unsigned. macOS builds are ad-hoc signed and not notarized; downloaded builds may need approval in Privacy & Security. These limitations are shown on the download cards.

## Check and publish

    npm run build
    npm test
    npm run release:local
    npm run dev

With the development server running:

    npm run test:browser

The build checks TypeScript and runs a Wrangler deployment dry run. Unit tests cover per-platform availability, headers, checksums, cache validators, byte ranges, and object replacement/failure handling. Browser tests cover desktop/mobile layout, keyboard controls, WCAG A/AA, clipboard, a complete portable ZIP hash check, and each platform's real download routes. They use installed Chrome; STRIFE_TEST_BROWSER=msedge selects Edge. STRIFE_WEB_URL overrides the local test URL.

To publish, authenticate with `npx wrangler login`. The existing bucket is **strife-releases**; a new account would need `npx wrangler r2 bucket create strife-releases` once.

    npm run release:upload
    npm run build
    npm test
    npm run deploy

**Upload before deploying metadata.** The uploader verifies every local file's size and hash before sending any objects to R2. Remote upload and deployment modify Cloudflare. The Worker declares strife.zip as a Custom Domain; workers.dev and preview URLs are disabled.

After deployment, check https://strife.zip/api/release: every downloads entry should have available: true. Run `npm run release:verify` to download every package and verify its complete SHA-256, size, headers, checksum file, and byte-range support. Pass a local origin with `npm run release:verify -- http://127.0.0.1:4317` for local verification. For CI, supply CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN through the CI secret store with Worker deployment and R2 permissions.

## Files and routes

- public/index.html, public/style.css, public/app.js: landing page, responsive download cards, preview controls, and checksums.
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

The illustrated interface uses sample conversations and an original fictional movie poster and is labeled as an illustration. Source and issue links point to https://github.com/M-ax/strife.
