# strife-web

Landing and download page for **Strife**, configured for a Cloudflare Worker at **https://strife.zip**.

The site uses static HTML/CSS, self-hosted fonts, and a small JavaScript enhancement for the interface preview and release information. A TypeScript Worker serves Windows downloads from a private R2 bucket. No browser framework, external font requests, analytics scripts, cookies, or production credentials are needed.

## Local development

Use Node.js 24 or newer:

    npm ci
    npm run dev

Open **http://localhost:4317**. Wrangler emulates the Worker and its R2 binding locally; it does not deploy the site.

Until the release archive is seeded, the page offers the app's source instead of advertising an unavailable download. The direct download route also returns a useful 503 page.

### Prepare a real download

The initial release is a Windows x64 preview built from the neighboring Strife app. Its archive is kept in the gitignored releases directory; release.json contains its version, filename, byte length, date, and SHA-256 hash. The archive includes the .NET runtime, native Mumble engine, RNNoise, web assets, and third-party notices.

To package another published Strife build, run PowerShell:

    ./scripts/package-release.ps1 -SourceDirectory ../strife/artifacts/Strife-updated -Version 0.1.0-preview.2
    npm run release:local

Choose a new version for every new archive. The packaging script refuses to replace an existing version; download objects should stay immutable so resuming a download cannot mix two different builds. The upload script verifies the archive's size and hash before invoking Wrangler.

To test the already-prepared initial archive on this workstation, only npm run release:local is needed. On a fresh clone, obtain the matching archive from the release maintainer or package a new build before seeding R2.

## Checks

    npm run build
    npm test

The build checks TypeScript and runs a Wrangler deployment dry run. It does not publish anything. Unit tests cover release availability, unavailable objects, download headers, byte ranges, cache validators, checksums, and failure handling.

With npm run dev running and a real release seeded locally:

    npm run test:browser

Browser tests use installed Google Chrome. STRIFE_TEST_BROWSER=msedge selects Edge; STRIFE_WEB_URL overrides the local URL. They exercise the actual Worker, keyboard interaction, interface controls, FAQ, checksum copying, release fallback, desktop and mobile layouts, WCAG A/AA checks, 404 responses, and a complete ZIP download whose SHA-256 must match release.json.

Screenshots and the downloaded test ZIP go in the gitignored artifacts directory.

## Deploy to strife.zip

Prerequisites: the strife.zip zone is active in your Cloudflare account, Workers is available, and R2 is enabled. No Cloudflare account ID or secret is committed.

1. Authenticate with Cloudflare:

       npx wrangler login

2. Create the download bucket once:

       npx wrangler r2 bucket create strife-releases

3. Upload the archive matching release.json:

       npm run release:upload

4. Check and deploy:

       npm run build
       npm test
       npm run deploy

The remote upload and deployment commands change your Cloudflare account. The Worker configuration binds RELEASES to strife-releases and declares strife.zip as a Custom Domain. Workers' default public subdomain and preview URLs are disabled.

Upload the release before deploying the matching metadata. Verify https://strife.zip/api/release reports available: true, then download the ZIP and compare its hash. If the object is absent or its size differs from the manifest, visitors see a source link and a temporary-unavailability message instead of a broken download button.

For CI, provide CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN through your CI secret store. The token needs the appropriate permissions for the deployment and, when uploading, R2.

Cloudflare references: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Files and routes

- public/index.html: landing page, copy, inline interface illustration.
- public/style.css: responsive layout, typography, and reduced-motion handling.
- public/app.js: preview controls, release metadata, and checksum clipboard support.
- public/_headers: security and asset caching headers.
- src/worker.ts: release API and streamed R2 downloads.
- release.json: metadata for the current Windows preview.
- GET /api/release: current metadata and actual R2 availability.
- GET or HEAD /download/windows-x64: ZIP with byte-range and ETag support.
- GET or HEAD /download/windows-x64.sha256: checksum file.
- Unknown paths: a real 404 page, not a landing-page fallback.

The download handler streams from R2 without buffering the archive in Worker memory. It accepts only a fixed release route, never an arbitrary object key or remote URL. The website remains usable without JavaScript; enhancement failures do not remove its content or native download links.

The illustrated interface uses sample conversations and an original fictional movie poster. It is labeled as an illustration. There are no fake testimonials, usage statistics, or nonexistent macOS/Linux downloads.

## Assets

Barlow Condensed and DM Sans are self-hosted under their SIL Open Font Licenses, included next to the font files. To refresh from the pinned npm dependencies:

    npm run fonts

The logo, favicon, interface illustration, and social image are original SVG/CSS artwork. The share image has an editable SVG source; regenerate its PNG with:

    node scripts/render-social.mjs

Source and issue links point to the existing app repository, https://github.com/M-ax/strife.
