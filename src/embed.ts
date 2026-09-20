// Bridge for drawio's embedded editor protocol (`?embed=1&proto=json`).
//
// Message flow (verified against jgraph/drawio EditorUi.js):
//   iframe → parent : {event:'init'} once ready
//   parent → iframe : {action:'load', xml, autosave:1} then content edits
//   iframe → parent : {event:'autosave', xml} after edits (autosave:1)
//                     {event:'export', format, data?, svg?, xml} for exports
//                     {event:'save'|'exit'|'template'|'openLink', ...}
//   parent → iframe : {action:'export', format:'png'|'svg'|..., border, ...}
//
// Messages are JSON strings; targets use '*' because the DBX plugin iframe
// has an opaque origin.

export interface DrawioMessage {
  event?: string;
  action?: string;
  xml?: string;
  data?: string;
  svg?: string;
  format?: string;
  [key: string]: unknown;
}

export type XmlSource = "load" | "autosave" | "save" | "export";

export interface DrawioEmbedHandlers {
  /** Fired once when the embedded editor finished booting. */
  onReady?: () => void;
  /** Every content-bearing event carries the current diagram XML. */
  onXml?: (xml: string, source: XmlSource) => void;
  /** Catch-all for protocol events ('exit', 'template', 'openLink', ...). */
  onEvent?: (message: DrawioMessage) => void;
}

export type ExportFormat = "png" | "xmlpng" | "svg" | "xmlsvg" | "jpg";

const EXPORT_TIMEOUT_MS = 20000;

export class DrawioEmbed {
  private handlers: DrawioEmbedHandlers;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private pendingExport: { resolve: (message: DrawioMessage) => void; reject: (error: Error) => void; timer: number } | null = null;
  // drawio runs in this same document (no nested iframe), so its embed
  // messages arrive on our own window with `window.parent === window`.
  private source: Window | null;

  constructor(handlers: DrawioEmbedHandlers = {}, source: Window | null = window) {
    this.handlers = handlers;
    this.source = source;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    window.addEventListener("message", this.onMessage);
  }

  get ready(): Promise<void> {
    return this.readyPromise;
  }

  private onMessage = (event: MessageEvent): void => {
    if (this.source && event.source !== this.source) return;
    const message = parseDrawioMessage(event.data);
    // Self-delivery also receives our outgoing actions. They are not replies.
    if (!message || typeof message.event !== "string") return;

    if (message.event === "init") {
      this.readyResolve();
      this.handlers.onReady?.();
      return;
    }

    if (["load", "autosave", "save", "export"].includes(message.event) && typeof message.xml === "string" && message.xml.length > 0) {
      const source: XmlSource =
        message.event === "autosave"
          ? "autosave"
          : message.event === "save"
            ? "save"
            : message.event === "load"
              ? "load"
              : "export";
      this.handlers.onXml?.(message.xml, source);
    }

    if (message.event === "export" && this.pendingExport) {
      const pending = this.pendingExport;
      this.pendingExport = null;
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(message.error)));
      else pending.resolve(message);
      return;
    }

    this.handlers.onEvent?.(message);
  };

  /** Posts a protocol action to the embedded editor. */
  send(action: DrawioMessage): void {
    (this.source ?? window).postMessage(JSON.stringify(action), "*");
  }

  /** Loads (or replaces) the diagram shown in the editor. */
  loadXml(xml: string): void {
    this.send({ action: "load", xml, autosave: 1 });
  }

  /**
   * Requests a raster/vector export. Resolves with the reply message whose
   * `data` is a data URL for images (and `xml` always carries the model).
   */
  exportImage(format: ExportFormat, options: Record<string, unknown> = {}): Promise<DrawioMessage> {
    if (this.pendingExport) {
      return Promise.reject(new Error("Export already in progress"));
    }
    return new Promise<DrawioMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pendingExport) this.pendingExport = null;
        reject(new Error(`Export timed out (${format})`));
      }, EXPORT_TIMEOUT_MS);
      this.pendingExport = { resolve, reject, timer };
      this.send({ action: "export", format, ...options });
    });
  }

  dispose(): void {
    window.removeEventListener("message", this.onMessage);
    if (this.pendingExport) {
      clearTimeout(this.pendingExport.timer);
      this.pendingExport.reject(new Error("disposed"));
      this.pendingExport = null;
    }
  }
}

export function parseDrawioMessage(data: unknown): DrawioMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as DrawioMessage;
    if (parsed && typeof parsed === "object" && ("event" in parsed || "action" in parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Minimal empty diagram used for "new". */
export function emptyDiagramXml(): string {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;
}

/** Extracts raw bytes from a data URL (drawio exports come as data URLs). */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return null;
  const payload = dataUrl.slice(comma + 1);
  try {
    if (!/;base64$/i.test(dataUrl.slice(0, comma))) {
      return new TextEncoder().encode(decodeURIComponent(payload));
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
