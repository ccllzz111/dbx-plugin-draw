# DBX Draw

An offline diagramming workspace powered by [draw.io](https://www.drawio.com),
embedded directly in [DBX](https://github.com/t8y2/dbx). Create flowcharts,
architecture diagrams, entity-relationship diagrams and technical illustrations
without leaving your database workspace.

[English](README.md) | [简体中文](README.zh-CN.md)

## What's inside

- **Editor** — bundled draw.io 31.4.6: shapes, connectors, layers, pages,
  undo/redo, zoom and shape libraries, with the native draw.io interface.
- **Files** — import draw.io XML, save `.drawio`, export PNG/SVG, and copy XML
  through the DBX host bridge. Files remain compatible with draw.io.
- **Mathematics** — bundled MathJax 4.1.3 and TeX fonts for offline LaTeX and
  AsciiMath rendering, including formulas in diagram exports.
- **Recent files** — reopen, remove or clear up to 10 recently imported or
  saved diagram copies.
- **Appearance & shortcuts** — light/dark appearance follows DBX; the plugin
  provides Chinese/English UI. draw.io adapts keyboard shortcuts and menu labels
  to macOS, Windows and Linux. An offline shortcut reference is included.
- **Save confirmation** — the editor's Exit button offers Save / Don't save /
  Cancel. Cancelled or failed saves keep the editor open.

The plugin is frontend-only: Vue 3, the draw.io editor and local assets. There
is no native sidecar, runtime CDN dependency or additional manifest permission.

## Install

Requires **DBX 0.6.15+** with Host API 1. A single **`universal`** `.dbxp` package
is used for macOS, Windows and Linux; users do not need Node.js installed.

For manual installation, download the `.dbxp` from
[GitHub Releases](https://github.com/ccllzz111/dbx-plugin-draw/releases) and select
it in the DBX Plugin Center's local installation flow. GitHub Release packages
are **unsigned review candidates** and require DBX's unsigned development-package
option. After an upgrade, close the old draw tab and restart DBX.

Official store installation uses the DBX Store-signed package after review and
listing. A GitHub Release alone does not make a package an official store release.

CI checks and builds on all three operating systems. Development and browser
sandbox testing have been performed on macOS; native DBX UI testing on Windows
and Linux is still pending.

## Saving & recent files

Editing updates the diagram held in memory. **Save `.drawio`** opens the host's
save dialog and writes the file only after confirmation; PNG/SVG exports do not
replace saving the editable diagram. The main `⌘S` / `Ctrl+S` shortcut currently
runs draw.io's **Save and Exit** action. Use the bottom Save button to save
without closing.

Recent entries contain XML copies captured when importing or successfully saving:

| Environment | Recent-file storage |
| --- | --- |
| Current DBX sandbox | In memory, for the current plugin session |
| Standalone browser preview | Browser `localStorage`, across reloads |
| Host providing the optional storage API | Storage supplied by that host |

The list holds up to 10 copies within a 1.5 MiB JSON budget. Files too large for
history still import/save normally. Reopening a recent entry loads its recorded
copy, not later changes to the original disk file. Removing an entry or clearing
history does not delete the original file. Recent history is not autosave or a
backup of unsaved edits.

## Develop

Requirements: **Node.js 22+** and npm. No Go or Rust toolchain is needed.

```bash
npm ci
npm run dev                    # standalone browser preview with a mock host
```

To use the DBX plugin development runtime:

```bash
npx --yes @dbx-app/plugin-cli@0.1.9 dev --path . --port 5190
```

The CLI uses the build/watch commands in `dbx-plugin.toml`. Successful builds
print `DBX_UI_BUILD_SUCCESS` so the development runtime can reload the UI.

```bash
npm run check                  # Vue / TypeScript checks
npm test                       # protocol, save state, recent files, links and VFS
npm run build                  # production UI -> ui/
npm run build:watch             # rebuild on changes
```

### Bundled assets

The selected draw.io distribution is checked into `public/drawio/`.
[`vendor/drawio.json`](vendor/drawio.json) records its upstream commit and each
file's SHA-256. Dev/build hooks verify these assets and prepare MathJax from the
exact npm versions in `package-lock.json`.

DBX loads plugin UI inside a restricted `srcdoc` iframe. The virtual filesystem
in `src/vfs.ts` serves local assets through the host bridge as blob/data URLs.
Large JavaScript bundles and the SVG font are split into roughly 1 MiB parts
and reassembled at runtime to fit the bridge transport.

Browser integration checks should also run under DBX's sandbox and CSP,
including `connect-src 'none'`; a standalone preview does not reproduce every
host restriction.

## Package

```bash
npm ci
npm run build
npx --yes @dbx-app/plugin-cli@0.1.9 package .
```

The output is `dist/ccllzz111.dbx-draw-<version>-universal.dbxp`, containing
the built UI, draw.io assets, MathJax components and fonts, plugin icon and
third-party notices. No platform-specific executable is included.

## Release & store submission

1. Update the version in `manifest.json`, `package.json` and `package-lock.json`.
   Commit and push the changes, then publish a GitHub Release with the matching
   `v<version>` tag.
2. The **Release DBX plugin** workflow checks, tests, builds and packages that
   tag. It attaches the unsigned `.dbxp`, `.artifact.json`,
   `release-candidates.json` and `dbx-store-submission.zip` to the Release.
3. Fork [DBX Store](https://github.com/t8y2/dbx-store), copy the generated candidate
   file into it, and include the publisher file on the first submission only.
   Open a PR against `t8y2/dbx-store:main` with the review information.
4. DBX Store maintainers review, sign and finalize the catalog on that PR.
   Authors do not need an official signing key or an OS signing certificate.

Detailed instructions: [发布与商店提交步骤](docs/PUBLISHING.zh-CN.md).
A [store PR description](docs/STORE_PR.md) is also provided.

`npm run release:metadata` generates submission files from a local package for
inspection. For the actual PR, use the metadata attached to the Release: hashes
and byte sizes must match the exact published package. Source and unsigned
candidates stay in this repository; ordinary plugin source does not belong in
the DBX host or store repository.

## Known limits

- **Direct host-tab closure** cannot be intercepted on the current DBX host.
  Save before closing the tab, or use the editor's Exit button for confirmation.
- **Recent files are session-only in current DBX**, and unsaved edits are not
  persisted automatically. See the storage model above.
- **External links** cannot open a browser from the current sandbox. Help links
  show the official URL with a copy button; the shortcut reference opens locally.
- **Cloud integrations and network-dependent features** of the web editor are
  unavailable. This plugin does not claim complete draw.io web feature parity.
- **The shortcut reference is a static upstream chart**. It includes macOS
  substitution notes; actual editor shortcuts and menu labels adapt to the OS.

## Credits & licenses

DBX Draw is powered by [draw.io](https://github.com/jgraph/drawio),
[MathJax](https://github.com/mathjax/MathJax) and [Vue](https://github.com/vuejs/core).

Integration code is licensed under [Apache-2.0](LICENSE). Bundled software and
shape/icon assets retain their own licenses and restrictions; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A copy ships inside every package
under `ui/`, alongside the relevant license texts.

This is an independent DBX plugin, not an official draw.io/JGraph product or an
endorsement by those projects.
