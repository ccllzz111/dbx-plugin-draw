# dbx-plugin-draw

An independent integration of the draw.io editor embedded in the DBX plugin workbench, with Vue 3
providing file operations and the host bridge. Editing and MathJax 4 formula
rendering run offline; bundled assets are loaded through a virtual filesystem
because DBX uses a restricted `srcdoc` sandbox.

## Features

- draw.io shapes, connectors, layers, pages, undo/redo and XML import
- Save `.drawio`, export PNG/SVG, and copy XML through the DBX bridge
- Offline LaTeX/AsciiMath rendering, including SVG exports
- Native draw.io styling, with light/dark appearance following DBX
- Chinese/English UI and an offline keyboard shortcut reference
- Save / don't save / cancel when using the editor's Exit button
- Ten recent imported/saved copies, with reopen, remove and clear controls

## Sandbox differences from the web editor

DBX currently provides neither popup permission nor an external-browser bridge
API. Help links therefore show the official URL with a copy button; keyboard
shortcuts also show the bundled reference. Standalone browser mode opens links
in a new tab. Opening the system browser directly requires a DBX host change.
Cloud storage, online services and other features requiring network access are
not available in the offline sandbox. This is not a claim of full web-editor
feature parity.

## Recent files and closing (0.3.21)

No DBX host changes are included or required. In the current DBX sandbox,
recent imported/saved XML copies remain available during this session;
standalone browser preview persists them in localStorage. Up to 10 entries
are retained within a 1.5 MiB JSON budget. Reopening a copy does not read later
changes to the original disk file, and clearing history does not delete files.

The editor's Exit button offers Save / Don't save / Cancel. Directly closing
the host tab cannot be intercepted by the current DBX host; save first.
Optional support for host close guards and storage remains for compatible hosts,
but the plugin does not show host upgrade prompts.

## Development

```bash
npm ci
npm run dev
npm run check
npm test
npm run build
```

Use Node.js 22 or later. The selected draw.io 31.4.6 distribution is checked
into `public/drawio/`, with its source commit and file hashes in
`vendor/drawio.json`. Dev/build hooks verify those hashes and prepare pinned
MathJax components from npm. Runtime editing and math require no CDN.

CI builds on macOS, Windows and Linux; native DBX UI testing on Windows/Linux
is still pending. The package is platform-independent (`universal`).

## Package and install

```bash
npx --yes @dbx-app/plugin-cli@0.1.9 package .
```

Install `dist/*-universal.dbxp` from the DBX Plugin Center. After upgrading,
close the old draw tab and restart DBX so the workbench loads the new assets.

## Validation

Unit tests cover the embed protocol, file save/cancellation state, discard
confirmation, external links, SVG data URLs, and VFS callbacks/CSS rewriting.
Browser validation should also use a sandboxed `srcdoc` with DBX's CSP, including
`connect-src 'none'`, to exercise formula rendering, export and help links.

## Publish and submit

Repository: https://github.com/ccllzz111/dbx-plugin-draw

See [发布与商店提交步骤](docs/PUBLISHING.zh-CN.md). Publishing a versioned GitHub
Release builds unsigned candidates and generates the DBX Store PR files.
Official signing happens only after store review; authors need no signing key.

## License

Integration code: [Apache-2.0](LICENSE). Bundled components retain their own
licenses and asset restrictions; see [third-party notices](THIRD_PARTY_NOTICES.md).
DBX Draw is not an official draw.io/JGraph product.
