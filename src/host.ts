// Host bridge wrapper: uses the DBX-injected `window.dbxPlugin` inside the
// sandbox and falls back to a browser mock when running standalone via
// `npm run dev`, so the UI is fully developable without DBX.

export type Appearance = "light" | "dark";

export interface HostTheme {
  appearance: Appearance;
}

interface DbxPluginGlobal {
  ready: Promise<unknown>;
  readonly locale: string;
  readonly theme: HostTheme | undefined;
  readAsset?: (path: string) => Promise<{ contentType?: string; dataBase64: string }>;
  request(method: string, params?: unknown): Promise<unknown>;
  saveFile(options?: { fileName?: string; contentType?: string }, data?: ArrayBuffer | string): Promise<unknown>;
  copy(text: string): Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    dbxPlugin?: DbxPluginGlobal;
  }
}

const bridge = typeof window !== "undefined" ? window.dbxPlugin : undefined;

function downloadBlob(fileName: string, contentType: string, bytes: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function browserLocale(): string {
  const language = typeof navigator !== "undefined" ? navigator.language : "en";
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function systemAppearance(): Appearance {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// DBX's own design tokens (desktop styles/tokens.css pearl/dark sets). The
// real host pushes these as inline styles through the plugin SDK; the dev
// mock injects the same set so theme-following is fully developable and
// testable in a plain browser. Keep in sync with tokens.css and the
// fallbacks in App.vue's THEME_OVERRIDE_CSS.
const DEV_THEME_TOKENS: Record<Appearance, Record<string, string>> = {
  light: {
    "--color-background": "rgb(255 255 255)",
    "--color-foreground": "rgb(10 10 10)",
    "--color-card": "rgb(255 255 255)",
    "--color-card-foreground": "rgb(10 10 10)",
    "--color-popover": "rgb(255 255 255)",
    "--color-popover-foreground": "rgb(10 10 10)",
    "--color-primary": "rgb(23 23 23)",
    "--color-primary-foreground": "rgb(250 250 250)",
    "--color-secondary": "rgb(245 245 245)",
    "--color-secondary-foreground": "rgb(23 23 23)",
    "--color-muted": "rgb(245 245 245)",
    "--color-muted-foreground": "rgb(115 115 115)",
    "--color-accent": "rgb(245 245 245)",
    "--color-accent-foreground": "rgb(23 23 23)",
    "--color-border": "rgb(229 229 229)",
    "--color-input": "rgb(229 229 229)",
    "--color-ring": "rgb(161 161 161)",
    "--color-destructive": "rgb(231 0 11)",
  },
  dark: {
    "--color-background": "rgb(19 20 22)",
    "--color-foreground": "rgb(215 215 219)",
    "--color-card": "rgb(27 27 30)",
    "--color-card-foreground": "rgb(215 215 219)",
    "--color-popover": "rgb(30 30 32)",
    "--color-popover-foreground": "rgb(221 221 226)",
    "--color-primary": "rgb(208 208 214)",
    "--color-primary-foreground": "rgb(19 20 22)",
    "--color-secondary": "rgb(42 42 45)",
    "--color-secondary-foreground": "rgb(215 215 219)",
    "--color-muted": "rgb(42 42 45)",
    "--color-muted-foreground": "rgb(151 152 157)",
    "--color-accent": "rgb(46 47 51)",
    "--color-accent-foreground": "rgb(221 221 226)",
    "--color-border": "rgb(110 110 114 / 0.28)",
    "--color-input": "rgb(110 110 114 / 0.34)",
    "--color-ring": "rgb(133 134 139)",
    "--color-destructive": "rgb(243 98 95)",
  },
};

/** Applies the DBX token set to this document the way the host SDK does
 *  (dataset + color-scheme + inline custom properties). */
function applyDevThemeTokens(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.dbxTheme = appearance;
  root.style.colorScheme = appearance;
  for (const [name, value] of Object.entries(DEV_THEME_TOKENS[appearance])) {
    root.style.setProperty(name, value);
  }
}

class MockHost {
  readonly ready = Promise.resolve({});
  readonly locale = browserLocale();
  private listeners = new Set<() => void>();
  private forced: Appearance | null = null;

  constructor() {
    applyDevThemeTokens(this.theme.appearance);
    if (typeof matchMedia === "function") {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (!this.forced) {
          applyDevThemeTokens(this.theme.appearance);
          this.listeners.forEach((listener) => listener());
        }
      });
    }
  }

  get theme(): HostTheme {
    return { appearance: this.forced ?? systemAppearance() };
  }

  /** Dev-only hook: `__dbxMockTheme("dark" | "light")` flips the mock theme
   *  (and tokens) like the DBX host would; `null` returns to OS-following. */
  setAppearance(appearance: Appearance | null): void {
    this.forced = appearance;
    applyDevThemeTokens(this.theme.appearance);
    this.listeners.forEach((listener) => listener());
  }

  async request(method: string): Promise<unknown> {
    if (method === "host.getContext") return {};
    throw new Error(`Mock host does not implement '${method}'`);
  }

  async saveFile(options: { fileName?: string; contentType?: string } = {}, data?: ArrayBuffer | string): Promise<unknown> {
    let bytes: ArrayBuffer;
    if (typeof data === "string") {
      bytes = new TextEncoder().encode(data).buffer as ArrayBuffer;
    } else if (data instanceof ArrayBuffer) {
      bytes = data;
    } else {
      throw new Error("Mock host saveFile requires string or ArrayBuffer data");
    }
    downloadBlob(options.fileName ?? "untitled", options.contentType ?? "application/octet-stream", bytes);
    return { saved: true };
  }

  async copy(text: string): Promise<{ success: boolean }> {
    await navigator.clipboard.writeText(text);
    return { success: true };
  }

  onThemeChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const mock = bridge ? null : new MockHost();

// Dev affordance: flip the mock theme from the console or automation.
if (mock && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__dbxMockTheme = (appearance: Appearance | null) =>
    mock.setAppearance(appearance);
}

/** Resolves when the host bridge finished its handshake; never rejects and
 *  never blocks longer than `timeoutMs` (dev mocks resolve immediately). */
async function bridgeReady(timeoutMs = 15000): Promise<void> {
  const promise: Promise<unknown> = bridge ? bridge.ready : mock!.ready;
  await Promise.race([
    promise.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export const host = {
  isSandbox: Boolean(bridge),

  ready: bridgeReady,

  async readStorage(key: string): Promise<unknown> {
    if (bridge) return bridge.request("host.storage.get", { key });
    const value = localStorage.getItem(`dbx-draw:${key}`);
    return value === null ? null : JSON.parse(value);
  },

  async writeStorage(key: string, value: unknown): Promise<void> {
    if (bridge) { await bridge.request("host.storage.set", { key, value }); return; }
    localStorage.setItem(`dbx-draw:${key}`, JSON.stringify(value));
  },

  async onBeforeTabClose(handler: () => Promise<boolean>): Promise<() => void> {
    if (!bridge) return () => {};
    let pending: Promise<boolean> | undefined;
    const listener = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || !data || data.source !== "dbx-host" || data.version !== 1 || data.type !== "before-close" || typeof data.id !== "string") return;
      pending ??= handler().catch(() => false).finally(() => { pending = undefined; });
      void pending.then(allowed => window.parent.postMessage({
        source: "dbx-plugin", version: 1, type: "close-response", id: data.id, allowed,
      }, "*"));
    };
    window.addEventListener("message", listener);
    try { await bridge.request("host.setCloseGuard", { enabled: true }); }
    catch (error) { window.removeEventListener("message", listener); throw error; }
    return () => {
      window.removeEventListener("message", listener);
      void bridge.request("host.setCloseGuard", { enabled: false }).catch(() => {});
    };
  },

  get locale(): string {
    return (bridge ? bridge.locale : mock!.locale) || "en";
  },

  get appearance(): Appearance {
    if (bridge && bridge.theme) return bridge.theme.appearance === "dark" ? "dark" : "light";
    return mock ? mock.theme.appearance : "light";
  },

  async getContext(): Promise<unknown> {
    if (!bridge) return {};
    return bridge.request("host.getContext");
  },

  async saveFile(options: { fileName?: string; contentType?: string }, data: ArrayBuffer | string): Promise<unknown> {
    if (bridge) return bridge.saveFile(options, data);
    return mock!.saveFile(options, data);
  },

  async copy(text: string): Promise<{ success: boolean }> {
    if (bridge) return bridge.copy(text);
    return mock!.copy(text);
  },

  // Closes this plugin's workbench tab. The sandbox SDK has no request method
  // for it — the host bridge accepts the same `shortcut: closeTab` message its
  // own ⌘W handler posts ("dbx-plugin" source, bridge version 1). In dev there
  // is no tab to close; callers decide how to surface that.
  closeTab(): void {
    if (!bridge) return;
    window.parent?.postMessage(
      { source: "dbx-plugin", version: 1, type: "shortcut", shortcut: "closeTab" },
      "*",
    );
  },

  // The DBX bridge dispatches `dbx-plugin-env` on the document after applying
  // a pushed theme; the mock follows the OS color scheme instead.
  onThemeChange(listener: () => void): () => void {
    if (bridge) {
      const handler = () => listener();
      document.addEventListener("dbx-plugin-env", handler);
      return () => document.removeEventListener("dbx-plugin-env", handler);
    }
    return mock!.onThemeChange(listener);
  },
};

/** Reads a DBX design token (set on <html> by the host) with a light default. */
export function cssToken(name: string, fallback: string): string {
  if (typeof getComputedStyle === "function") {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) return value;
  }
  return fallback;
}
