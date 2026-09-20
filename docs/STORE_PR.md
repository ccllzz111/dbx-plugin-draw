## Add DBX Draw

- Plugin ID: `ccllzz111.dbx-draw`
- Publisher: `ccllzz111` (first submission, unverified)
- Source: https://github.com/ccllzz111/dbx-plugin-draw
- Target: `universal`; frontend-only, no native sidecar.
- License: Apache-2.0 for integration code; upstream notices and asset restrictions
  are preserved in THIRD_PARTY_NOTICES.md and the distributed package.

Features: offline draw.io diagram editing, MathJax formula rendering, drawio XML
import/save, PNG/SVG export, Chinese/English UI, and session recent-file copies.

Permissions and data:

- No additional manifest permissions or runtime network access.
- Imports read only files selected by the user; saves use the host save dialog.
- Clipboard writes occur only in response to user copy actions.
- Recent XML copies remain in memory with the current DBX sandbox; standalone
  browser preview uses localStorage. Optional future host storage is plugin-scoped.
- No backend process, telemetry or credentials.

Known limitations: direct host-tab closure cannot be intercepted on current DBX;
use the editor Exit button for save confirmation. Help URLs can be copied, but
DBX does not provide an external browser opener. Recent copies do not track disk changes.

Validation: see linked CI run for this release. macOS development and Chromium
sandbox integration tested; Windows/Linux build checks are not native UI tests.

Candidate URL, SHA-256 and byte size are generated from the exact Release package
in candidates/ccllzz111.dbx-draw.json. Request DBX Store review and signing.
