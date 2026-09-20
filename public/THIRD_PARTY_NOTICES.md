# Third-party software and assets

DBX Draw is an independent integration maintained by ccllzz111. It is not an
official product of draw.io, JGraph or DBX. Project integration code is licensed
under Apache-2.0; third-party components keep their own terms and notices.

## draw.io 31.4.6

- Source: https://github.com/jgraph/drawio/tree/744cb5420fdf126efd7a09b1d7082ca3e12c0841
- Copyright JGraph Holdings Ltd, draw.io AG and respective contributors.
- Main license: Apache-2.0, reproduced in `drawio/LICENSE` in the plugin UI.
- Selected web assets are vendored in `public/drawio`. Their byte hashes and
  source revision are recorded in `vendor/drawio.json`. Four large JavaScript
  bundles are split into 1 MiB parts without altering their concatenated bytes.
- Integration changes are applied at runtime by `src/vfs.ts`: same-window embed
  messaging, startup redirect suppression, local MathJax component paths and
  canvas visibility. Original copyright banners remain in the shipped files.
- Icon, shape and stencil assets have additional upstream restrictions, including
  restrictions on use in Atlassian products/ecosystems. See `drawio/SHAPES-LICENSE`
  and `drawio/stencils/LICENSE`. The Apache license of the integration does not
  replace those terms or grant rights to third-party trademarks.
- Bundled upstream libraries retain their embedded license notices. These include
  jQuery, DOMPurify, pako, JSZip, CryptoJS, Mermaid, Rough.js and mxGraph.

### libavoid

The vendored optional routing component includes libavoid under LGPL-2.1.
The full license is included in `drawio/js/libavoid-js/LICENSE`, together with
upstream build/source documentation in `README.md`. Source and build tooling:
https://github.com/jgraph/drawio-libavoid and https://github.com/mjwybrow/adaptagrams.
The component is shipped as a separate JavaScript asset; its upstream notice is
retained, and no restriction on modifying or replacing it is imposed by this project.

## MathJax and TeX fonts 4.1.3

- https://github.com/mathjax/MathJax (Apache-2.0)
- https://github.com/mathjax/mathjax-tex-font (Apache-2.0)
- Exact npm package versions and integrity hashes are in `package-lock.json`.
- Browser components are copied at build time; the large SVG font is split into
  byte parts for the host bridge. License: `drawio/math4/es5/LICENSE`.

## Vue 3

Vue and the bundled @vue runtime packages are MIT-licensed, copyright
Evan You and contributors. Exact versions are in `package-lock.json`.
License text is included in `licenses/vue-LICENSE` in the plugin UI.
