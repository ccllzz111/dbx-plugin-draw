// Virtual asset filesystem + same-document loader for drawio inside the DBX
// sandbox.
//
// The DBX host loads plugin UI as a `srcdoc` iframe (no base URL) with CSP
// `script-src 'unsafe-inline' blob:; img/font-src data: blob:;
// connect-src 'none'`. Nested iframes and relative URLs cannot work there
// (and WebKit caps srcdoc documents around ~200KB), so drawio is mounted
// into THIS document instead:
//
//   1. `installVfsShim(reader)` patches script/img/link src+href (property
//      setters AND setAttribute), fetch, XMLHttpRequest and neutralizes
//      document.write before drawio runs.
//   2. `mountDrawio(core)` injects drawio's boot scripts inline; its dynamic
//      `mxscript` loads then resolve through the shim into blob:/data: URLs
//      served from `ui.readAsset` (bridge) or dev HTTP.

import splitBundles from "./drawio-bundles.json";

export interface VfsAsset {
  contentType: string;
  bytes: Uint8Array;
}

/** Shell-side source for one asset: the DBX bridge or plain HTTP in dev. */
export type AssetReader = (path: string) => Promise<VfsAsset>;

export interface VfsStats {
  cacheSize: number;
  misses: string[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function contentTypeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    html: "text/html",
    js: "text/javascript",
    css: "text/css",
    json: "application/json",
    txt: "text/plain",
    xml: "application/xml",
    png: "image/png",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return types[extension] ?? "application/octet-stream";
}

function resolvePath(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  if (/^(data:|blob:|https?:|\/\/|about:|#)/i.test(url)) return null;
  const clean = url.split("#")[0].split("?")[0];
  if (!clean) return null;
  const stack: string[] = [];
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.length ? stack.join("/") : null;
}

/** readAsset adapter over the DBX bridge (base64 payloads) or dev fetch. */
export function createAssetReader(): AssetReader {
  const readAsset = typeof window !== "undefined" ? window.dbxPlugin?.readAsset : undefined;
  if (readAsset) {
    const withRetry = async (path: string): Promise<VfsAsset> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt));
        }
        const timer = new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("bridge timeout")), 20000),
        );
        try {
          const asset = (await Promise.race([readAsset(path), timer])) as {
            contentType?: string;
            dataBase64?: string;
          };
          if (!asset || typeof asset.dataBase64 !== "string") throw new Error("unreadable payload");
          const binary = atob(asset.dataBase64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          return { contentType: asset.contentType || contentTypeFor(path), bytes };
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`readAsset ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    };
    // Large bundles ship as ~1MB parts; WKWebView IPC cannot carry the whole
    // base64 payload in one bridge response.
    return assembleParts(async (path) => withRetry(`drawio/${path}`));
  }
  // Capture the pristine fetch BEFORE installVfsShim replaces window.fetch:
  // resolving this reader's own requests through the shim would re-enter it
  // and stack the `drawio/` prefix on every recursion until it 404s.
  const pristineFetch = typeof window !== "undefined" ? window.fetch?.bind(window) : undefined;
  const rawFetch: AssetReader = async (path) => {
    if (!pristineFetch) throw new Error("fetch unavailable");
    const response = await pristineFetch(`drawio/${path}`);
    // A text/html body for a non-HTML path is the dev server's SPA fallback
    // for a missing file — returning it would poison consumers (e.g.
    // mxResources parsing our own index.html). Fail as a miss instead.
    // index.html & friends legitimately are text/html.
    const contentType = response.headers.get("content-type") || "";
    const isHtmlAsset = /\.html?$/i.test(path);
    const spaFallback = contentType.includes("text/html") && !isHtmlAsset;
    if (!response.ok || spaFallback) {
      throw new Error(`asset ${path}: HTTP ${response.status}${spaFallback ? " (SPA fallback)" : ""}`);
    }
    return {
      contentType: contentType.split(";")[0] || contentTypeFor(path),
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  };
  return assembleParts(rawFetch);
}

/** Wraps a raw reader so split bundles are reassembled transparently. */
function assembleParts(raw: AssetReader): AssetReader {
  const parts = splitBundles as Record<string, number>;
  return async (path) => {
    const count = parts[path];
    if (!count) return raw(path);
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => raw(`${path}.part-${String(index).padStart(4, "0")}`).then((asset) => asset.bytes)),
    );
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return { contentType: contentTypeFor(path), bytes: joined };
  };
}

interface CacheEntry {
  t: string;
  b: string;
  url?: string;
  urlMime?: string;
}

// --------------------------------------------------------------------- shim

export interface VfsHandle {
  stats(): VfsStats;
}

export function installVfsShim(read: AssetReader, onInfo?: (message: string) => void): VfsHandle {
  // HMR remounts re-run the mount pipeline; wrapping the already-shimmed
  // fetch/XMLHttpRequest again stacks the `drawio/` prefix until every read
  // 404s into the dev server's SPA fallback. Idempotency guard: keep the
  // first installation alive and hand the remount a stub.
  const w = window as unknown as Record<string, unknown>;
  if (w.__dbxVfsInstalled) {
    onInfo?.("vfs shim already installed — HMR remount keeps the first instance");
    return { stats: () => ({ cacheSize: 0, misses: ["vfs-shim-reused"] }) };
  }
  w.__dbxVfsInstalled = true;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<CacheEntry>>();
  const misses: string[] = [];

  function recordMiss(url: string): void {
    if (misses.length < 200 && !misses.includes(url)) {
      misses.push(url);
      // eslint-disable-next-line no-console
      console.warn("[dbx-vfs] miss:", url);
      onInfo?.(`asset missing: ${url}`);
    }
  }

  function decode(entry: CacheEntry): Uint8Array {
    const binary = atob(entry.b);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  }

  function request(path: string): Promise<CacheEntry> {
    const cached = cache.get(path);
    if (cached) return Promise.resolve(cached);
    const inflight = pending.get(path);
    if (inflight) return inflight;
    const promise = read(path)
      .then((asset) => {
        const entry: CacheEntry = { t: asset.contentType, b: toBase64(asset.bytes) };
        cache.set(path, entry);
        return entry;
      })
      .finally(() => pending.delete(path));
    pending.set(path, promise);
    return promise;
  }

  const toDataUrl = (entry: CacheEntry) => `data:${entry.t};base64,${entry.b}`;
  function toBlobUrl(entry: CacheEntry, mime: string): string {
    if (!entry.url || entry.urlMime !== mime) {
      entry.url = URL.createObjectURL(new Blob([decode(entry).buffer as ArrayBuffer], { type: mime }));
      entry.urlMime = mime;
    }
    return entry.url;
  }

  async function transformFor(tag: string, path: string, entry: CacheEntry): Promise<string> {
    if (tag === "SCRIPT") {
      let text: string | null = null;
      if (path === "js/app.min.js") {
        // Same-document embed: drawio's protocol peer is `window.opener ||
        // window.parent` (the host page) and its message handler drops every
        // event whose source is not that peer. Rewire the whole protocol onto
        // this same window: send targets become `window` (self-delivery), and
        // the receive guard `K.source == (this.embedMessageSource || window)`
        // then matches because a self-posted MessageEvent has source ===
        // window. Two expressions need dedicated surgery first:
        //   a) the embed-mode enable check (`peer != window`) must not
        //      collapse to `window != window` — neutralize it;
        //   b) with every self-posted message now reaching drawio's own
        //      handler, its outgoing replies ({event:...}/{error:...}) would
        //      be answered with {error:"unknownMessage"} in an infinite
        //      postMessage echo loop that pins the main thread. Restrict the
        //      guard to JSON actions from this window: DrawioEmbed always
        //      serializes `action` first.
        //   c) stash the App instance so the shell can drive runtime state
        //      (theme via setDarkMode; full toolbar via setCompactMode(false)
        //      — embed mode auto-collapses the toolbar at screen.height<=740).
        let source = new TextDecoder().decode(decode(entry));
        const enableCheck =
          /\(this\.embedMessageSource\s*\|\|\s*window\.opener\s*\|\|\s*window\.parent\)\s*!=\s*window\s*&&/g;
        const guardRx =
          /function\((\w+)\)\{if\(\1\.source==\(this\.embedMessageSource\|\|window\.opener\|\|window\.parent\)\)\{/;
        const appCtor = "k():new App(";
        if (!enableCheck.test(source) || !guardRx.test(source) || !source.includes(appCtor)) {
          // eslint-disable-next-line no-console
          console.warn("[dbx-vfs] app.min.js embed patterns not found — bundle changed?");
        }
        source = source
          // Blob scripts have no usable directory. MathJax must resolve all
          // components through our local VFS, including its font bundle.
          .replace('paths:{fonts:DRAW_MATH_URL+"/fonts"}', 'paths:{mathjax:DRAW_MATH_URL,fonts:DRAW_MATH_URL+"/fonts"}')
          // Keep the canvas visible even if a math component fails to load.
          // Upstream hides it until onMathJaxDone, which may never arrive.
          .replace('this.graph.container.style.visibility=\n"hidden"),Editor.MathJaxRender', 'this.graph.container.style.visibility=\n""),Editor.MathJaxRender')
          .replace(enableCheck, "(!0)&&/* dbx: same-window embed */")
          .replace(
            guardRx,
            'function($1){if($1.source==window&&"string"==typeof $1.data&&0===$1.data.indexOf(\'{"action":\')){',
          )
          .replace(appCtor, "k():window.__dbxUi=new App(")
          .replace(/window\.opener\s*\|\|\s*window\.parent/g, "window");
        text = source;
      }
      if (text !== null) {
        return URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
      }
      return toBlobUrl(entry, "text/javascript");
    }
    if (tag === "LINK") {
      if (!entry.url || entry.urlMime !== "text/css") {
        const css = await rewriteCss(new TextDecoder().decode(decode(entry)), path);
        entry.url = URL.createObjectURL(new Blob([css], { type: "text/css" }));
        entry.urlMime = "text/css";
      }
      return entry.url;
    }
    return toDataUrl(entry); // IMG
  }

  /** Applies the mapping; resolves to the rewritten URL or null. */
  function mapUrl(tag: string, url: string): Promise<string | null> {
    const path = resolvePath(url);
    if (!path) {
      if (url && !/^(data:|blob:)/i.test(url)) recordMiss(url);
      return Promise.resolve(null);
    }
    return request(path)
      .then((entry) => transformFor(tag, path, entry))
      .catch(() => {
        recordMiss(url);
        return null;
      });
  }

  // document.write/open in a srcdoc document implicitly reopens (wipes) it,
  // which would destroy the whole plugin UI.
  const blocked = (name: string) => (...args: string[]) => {
    // eslint-disable-next-line no-console
    console.warn("[dbx-vfs] blocked document." + name + ":", args.join("").slice(0, 80));
  };
  document.write = blocked("write") as typeof document.write;
  document.writeln = blocked("writeln") as typeof document.writeln;
  document.open = blocked("open") as typeof document.open;
  document.close = blocked("close") as typeof document.close;

  // 1. property setters (el.src = ..., el.href = ...)
  function hookProperty(proto: HTMLElement, prop: "src" | "href"): void {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor?.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get?.call(this);
      },
      set(value: string) {
        if (typeof value !== "string") {
          descriptor.set?.call(this, value as never);
          return;
        }
        mapUrl((this as HTMLElement).tagName, value).then((mapped) => {
          descriptor.set?.call(this, (mapped ?? value) as never);
        });
      },
    });
  }
  hookProperty(HTMLScriptElement.prototype, "src");
  hookProperty(HTMLImageElement.prototype, "src");
  hookProperty(HTMLLinkElement.prototype, "href");

  // 2. setAttribute('src'/'href') — drawio's mxscript loader uses this path
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function patchedSetAttribute(
    this: Element,
    name: string,
    value: string,
  ) {
    const lower = name.toLowerCase();
    const tag = this.tagName;
    if ((lower === "src" || lower === "href") && (tag === "SCRIPT" || tag === "IMG" || tag === "LINK")) {
      const url = String(value);
      if (resolvePath(url)) {
        mapUrl(tag, url).then((mapped) => {
          nativeSetAttribute.call(this, name, mapped ?? value);
        });
        return;
      }
    }
    return nativeSetAttribute.call(this, name, value);
  } as typeof Element.prototype.setAttribute;

  // 3. CSS through <link> keeps relative url() references; rewrite them
  //    before creating the serving blob.
  function resolveRel(url: string, baseDir: string): string | null {
    if (!url || /^(data:|blob:|https?:|\/\/)/i.test(url)) return null;
    const clean = url.split("#")[0].split("?")[0];
    const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
    for (const segment of clean.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") stack.pop();
      else stack.push(segment);
    }
    return stack.join("/");
  }
  function rewriteCss(text: string, cssPath: string): Promise<string> {
    const baseDir = cssPath.includes("/") ? cssPath.slice(0, cssPath.lastIndexOf("/")) : "";
    const refs = new Map<string, string>();
    let match: RegExpExecArray | null;
    const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    while ((match = pattern.exec(text))) {
      const target = resolveRel(match[2], baseDir);
      if (target && !refs.has(target)) refs.set(target, "");
    }
    const paths = [...refs.keys()];
    return Promise.all(
      paths.map((assetPath) =>
        request(assetPath)
          .then((entry) => refs.set(assetPath, toDataUrl(entry)))
          .catch(() => refs.set(assetPath, "")),
      ),
    ).then(() =>
      text.replace(pattern, (original, _quote, url) => {
        const target = resolveRel(url, baseDir);
        const replacement = target ? refs.get(target) : "";
        return replacement ? `url("${replacement}")` : original;
      }),
    );
  }

  // 4. fetch — served purely in-memory so CSP connect-src never applies.
  const realFetch = window.fetch?.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    const path = resolvePath(url);
    if (path) {
      return request(path).then((entry) => {
        const body: BodyInit = /text|json|xml|javascript/.test(entry.t)
          ? new TextDecoder().decode(decode(entry))
          : (decode(entry).buffer as ArrayBuffer);
        return new Response(body, { status: 200, headers: { "Content-Type": entry.t } });
      });
    }
    recordMiss(url);
    return realFetch ? realFetch(input, init) : Promise.reject(new TypeError(`fetch blocked: ${url}`));
  }) as typeof fetch;

  // 5. XMLHttpRequest — minimal async implementation for the graph stack.
  class VfsXHR {
    readyState = 0;
    status = 0;
    statusText = "";
    responseText = "";
    responseXML: Document | null = null;
    response: unknown = null;
    responseType = "";
    onload: ((event?: unknown) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;
    onreadystatechange: (() => void) | null = null;
    private url = "";
    private headers = new Map<string, string>();
    private contentType = "";
    private listeners = new Map<string, Array<(event?: unknown) => void>>();

    open(_method: string, url: string): void {
      this.generation += 1;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(name: string, value: string): void {
      this.headers.set(name.toLowerCase(), value);
    }
    getResponseHeader(name: string): string | null {
      const key = name.toLowerCase();
      if (key === "content-type") return this.contentType || null;
      return this.headers.has(key) ? String(this.headers.get(key)) : null;
    }
    getAllResponseHeaders(): string {
      return this.contentType ? `content-type: ${this.contentType}\r\n` : "";
    }
    private generation = 0;
    abort(): void {
      this.generation += 1;
      this.readyState = 0;
      this.status = 0;
    }
    addEventListener(type: string, listener: (event?: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    removeEventListener(type: string, listener: (event?: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    }
    private dispatch(type: string): void {
      if (this.onreadystatechange) {
        try {
          this.onreadystatechange();
        } catch {
          /* listener errors must not break the chain */
        }
      }
      const handler = type === "load" ? this.onload : this.onerror;
      if (handler) {
        try {
          handler({});
        } catch {
          /* ignore */
        }
      }
      for (const listener of this.listeners.get(type) ?? []) {
        try {
          listener({});
        } catch {
          /* ignore */
        }
      }
    }
    send(): void {
      const generation = this.generation;
      const path = resolvePath(this.url);
      if (!path) {
        recordMiss(this.url);
        setTimeout(() => {
          if (generation !== this.generation) return;
          this.readyState = 4;
          this.status = 404;
          this.dispatch("error");
        }, 0);
        return;
      }
      request(path)
        .then((entry) => {
          if (generation !== this.generation) return;
          const bytes = decode(entry);
          this.contentType = entry.t;
          const text = new TextDecoder().decode(bytes);
          this.responseText = text;
          if (this.responseType === "arraybuffer") this.response = bytes.buffer;
          else if (this.responseType === "blob") this.response = new Blob([bytes.buffer as ArrayBuffer], { type: entry.t });
          else if (this.responseType === "json") {
            try {
              this.response = JSON.parse(text);
            } catch {
              this.response = null;
            }
          } else this.response = text;
          if (!this.responseType || this.responseType === "text") {
            try {
              this.responseXML = new DOMParser().parseFromString(
                text,
                entry.t.includes("html") ? "text/html" : "application/xml",
              );
            } catch {
              this.responseXML = null;
            }
          }
          this.readyState = 4;
          this.status = 200;
          this.statusText = "OK";
          this.dispatch("load");
        })
        .catch(() => {
          if (generation !== this.generation) return;
          recordMiss(this.url);
          this.readyState = 4;
          this.status = 404;
          this.dispatch("error");
        });
    }
  }
  window.XMLHttpRequest = VfsXHR as unknown as typeof XMLHttpRequest;

  return {
    stats: () => ({ cacheSize: cache.size, misses: [...misses] }),
  };
}

// ---------------------------------------------------------------- mounting

/**
 * Mounts drawio into the current document. `core` must contain "index.html",
 * "js/bootstrap.js" and "js/main.js" (all other files load through the shim).
 */
export async function mountDrawio(
  core: Map<string, VfsAsset>,
  options: { lang: string; dark?: boolean },
): Promise<void> {
  const indexHtml = new TextDecoder().decode(core.get("index.html")!.bytes);
  const source = new DOMParser().parseFromString(indexHtml, "text/html");

  // drawio derives urlParams from location.search (empty in srcdoc): merge
  // our parameters before bootstrap.js runs and keeps what we set.
  const params: Record<string, string> = {
    embed: "1",
    proto: "json",
    libraries: "1",
    noSaveBtn: "1",
    saveAndExit: "1",
    offline: "1",
    stealth: "1",
    spin: "1",
    suppressNewWindows: "1",
    lang: options.lang,
  };
  // Pin the editor's scheme to the DBX appearance (absent, embed mode boots
  // light regardless of the host — drawio's embed quirk).
  if (options.dark !== undefined) params.dark = options.dark ? "1" : "0";
  // Stylesheets load through the shim's link hook (url() assets rewritten).
  // The media attribute must survive the copy: index.html loads
  // high-contrast.css under `media="(forced-colors: active)"`, and losing
  // that attribute applies its forced black/white palette + !important
  // border rules in every mode (observed as too-dark borders and text).
  for (const link of [...source.querySelectorAll("link[rel='stylesheet'][href]")]) {
    const path = resolvePath(link.getAttribute("href") ?? "");
    if (!path) continue;
    const element = document.createElement("link");
    element.rel = "stylesheet";
    const media = link.getAttribute("media");
    if (media) element.media = media;
    element.href = path;
    document.head.appendChild(element);
  }

  // body classes + loading markup drawio replaces once booted
  document.body.classList.add("geEditor", "geClassic");
  const info = source.querySelector("#geInfo");
  if (info) document.body.appendChild(info);

  const inline = (path: string, transform?: (text: string) => string): void => {
    const asset = core.get(path);
    if (!asset) return;
    let text = new TextDecoder().decode(asset.bytes);
    if (transform) text = transform(text);
    const script = document.createElement("script");
    script.textContent = escapeScript(text);
    document.body.appendChild(script);
  };
  // bootstrap.js normalizes its host (draw.io -> app.diagrams.net) and
  // re-assigns location.href when the computed URL differs. In a srcdoc
  // document ("about:srcdoc") that computes "about://doc", the navigation
  // DESTROYS the whole plugin document — neutralize the redirect.
  inline("js/bootstrap.js", (text) =>
    text.replace("if (href != window.location.href)", "if (false) /* dbx: srcdoc redirect guard */"),
  );
  // bootstrap.js reassigns window.urlParams from location.search (empty in
  // srcdoc) when it runs — merge our parameters AFTER it, before anything
  // consumes them.
  const paramScript = document.createElement("script");
  paramScript.textContent = `window.urlParams = window.urlParams || {}; Object.assign(window.urlParams, ${JSON.stringify(params)});`;
  document.body.appendChild(paramScript);
  inline("js/main.js");
  // main.js waits for the window load event, which has already fired by the
  // time we inject scripts — run the same completion check directly.
  const kick = document.createElement("script");
  kick.textContent =
    'if (document.readyState === "complete" && typeof checkAllLoaded === "function") { window.mxWinLoaded = true; checkAllLoaded(); }';
  document.body.appendChild(kick);
}

/** Files needed before mountDrawio can run. */
export async function readCoreAssets(read: AssetReader): Promise<Map<string, VfsAsset>> {
  const paths = ["index.html", "js/bootstrap.js", "js/main.js"];
  const core = new Map<string, VfsAsset>();
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        return [path, await read(path)] as const;
      } catch {
        return null;
      }
    }),
  );
  for (const result of results) {
    if (result) core.set(result[0], result[1]);
  }
  return core;
}
