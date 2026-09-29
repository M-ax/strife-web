# Working in strife-web

Use Node.js 24+. The site is static HTML served by a Cloudflare Worker. Run `npm run build` and `npm test` after changing release tooling. With the local server running, `npm run test:docs` checks the wiki, including copyable commands and access without JavaScript.

## Keep Strife build references current

An authorized Strife build/release push includes the new installers and platform archives in R2 unless the user explicitly requests a source-only update. Obtain and validate all advertised packages from the exact Strife source commit, import them under a new immutable version, run `npm run release:upload`, then deploy the updated website with `npm run deploy`. Upload packages before deploying their manifest. Finish with `npm run release:verify` against production; do not call the release published until every advertised package passes full byte/hash, header, and range verification. Documentation and Git pushes alone do not complete a release.

Whenever a new Strife build or build changes are pushed to `main` or `master`, always cross-check this site's landing page, wiki, download instructions, and release documentation against that Strife revision. Update affected feature descriptions, UI instructions, compatibility notes, and troubleshooting guidance, and commit/push those documentation changes with the authorized build update. Clearly distinguish source-only fixes from features included in the advertised packages.

`release.json` is the source of truth for the advertised Strife version, download filenames, and `sourceRef` (the Strife commit, tag, or branch used for that build). Prefer an immutable commit or release tag. Do not infer the published build from the latest upstream branch.

- Import packages with `node scripts/import-release.mjs ARTIFACT_DIRECTORY VERSION SOURCE_REF`, or use `scripts/package-release.ps1 -Version VERSION -SourceRef SOURCE_REF`. New versions require an explicit source ref; reimporting the same version preserves it when omitted. Imports refresh the website references automatically.
- After editing the manifest, run `npm run release:docs`. The offline updater scans **all HTML under `public/`**, including nested wiki pages, and changes only marked values and links. Commit the manifest and regenerated HTML together.
- Use `<!-- release:version -->CURRENT_VERSION<!-- /release -->` for a version and `<!-- release:filename:linux-x64 -->CURRENT_FILENAME<!-- /release -->` for a filename (substitute any download ID from the manifest). Keep `.sha256` outside the filename marker. Inline comments preserve command text and work without browser JavaScript.
- For build-specific source links, add `data-release-doc="docs/releases.md"` (or another repository-relative file such as `README.md`) to an `<a>` with a normal double-quoted `href`. The updater points it at `sourceRef` in `M-ax/strife`.
- Run `npm run release:docs:check` for a read-only freshness check. It is also part of `npm run check`, `npm run build`, and the `npm run deploy` preflight. It rejects unknown/malformed markers and unmarked Strife version/archive references or source-file links. Mark new references instead of hard-coding the current build.

The updater does not fetch releases, validate remote refs, upload packages, or deploy. Manually review OS/runtime requirements, signing status, UI instructions, and compatibility notes against the selected build. Change the wiki's **Last reviewed** date only after reviewing the instructions. Helltube, Mumble, Node, and other dependency pins have separate update procedures; do not bump them as part of a Strife reference refresh.
