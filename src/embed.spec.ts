// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { dataUrlToBytes, DrawioEmbed, emptyDiagramXml, parseDrawioMessage } from "./embed";

function fakeEmbed() {
  const contentWindow = { postMessage: vi.fn() } as unknown as MessageEventSource & { postMessage: ReturnType<typeof vi.fn> };
  const embed = new DrawioEmbed({}, contentWindow as unknown as Window);
  return { embed, contentWindow, postSpy: contentWindow.postMessage };
}

function deliver(source: MessageEventSource | null, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source, data }));
}

describe("parseDrawioMessage", () => {
  it("parses JSON protocol messages", () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: "init" });
    expect(parseDrawioMessage('{"action":"load"}')?.action).toBe("load");
  });

  it("rejects non-protocol payloads", () => {
    expect(parseDrawioMessage("ready")).toBeNull();
    expect(parseDrawioMessage('{"foo":1}')).toBeNull();
    expect(parseDrawioMessage(null)).toBeNull();
  });
});

describe("DrawioEmbed", () => {
  it("ignores self-delivered load actions instead of treating them as exported XML", () => {
    const onXml = vi.fn();
    const embed = new DrawioEmbed({ onXml }, window);
    deliver(window, JSON.stringify({ action: 'load', xml: '<mxGraphModel/>' }));
    expect(onXml).not.toHaveBeenCalled();
    embed.dispose();
  });
  it("resolves ready on init from its own iframe", async () => {
    const { embed, contentWindow } = fakeEmbed();
    let ready = false;
    embed.ready.then(() => (ready = true));
    deliver(null, '{"event":"init"}');
    expect(ready).toBe(false);
    deliver(contentWindow, '{"event":"init"}');
    await embed.ready;
    expect(ready).toBe(true);
    embed.dispose();
  });

  it("loads XML with autosave enabled", () => {
    const { embed, postSpy } = fakeEmbed();
    embed.loadXml(emptyDiagramXml());
    expect(postSpy).toHaveBeenCalledWith(
      JSON.stringify({ action: "load", xml: emptyDiagramXml(), autosave: 1 }),
      "*",
    );
    embed.dispose();
  });

  it("reports xml from autosave, load, save and export events", () => {
    const onXml = vi.fn();
    const { embed, contentWindow } = fakeEmbed();
    const scoped = new DrawioEmbed({ onXml }, contentWindow as unknown as Window);
    deliver(contentWindow, JSON.stringify({ event: "autosave", xml: "<a/>" }));
    deliver(contentWindow, JSON.stringify({ event: "export", format: "png", xml: "<b/>" }));
    deliver(contentWindow, JSON.stringify({ event: "exit" }));
    scoped.dispose();
    expect(onXml.mock.calls.map((call) => [call[1], call[0]])).toEqual([
      ["autosave", "<a/>"],
      ["export", "<b/>"],
    ]);
    embed.dispose();
  });

  it("resolves exportImage with the export reply", async () => {
    const { embed, contentWindow } = fakeEmbed();
    const promise = embed.exportImage("png", { border: 16 });
    deliver(contentWindow, JSON.stringify({ event: "export", format: "png", data: "data:image/png;base64,AAAA" }));
    const reply = await promise;
    expect(reply.data).toBe("data:image/png;base64,AAAA");
    embed.dispose();
  });

  it("rejects concurrent exports", async () => {
    const { embed } = fakeEmbed();
    const first = embed.exportImage("png");
    await expect(embed.exportImage("svg")).rejects.toThrow("already in progress");
    embed.dispose();
    await expect(first).rejects.toThrow("disposed");
  });
});

describe("dataUrlToBytes", () => {
  it("decodes percent-encoded UTF-8 SVG exports", () => {
    const svg = '<svg><text>中文</text></svg>';
    expect(dataUrlToBytes(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toEqual(new TextEncoder().encode(svg));
    expect(dataUrlToBytes('data:image/svg+xml,%invalid')).toBeNull();
  });
  it("decodes base64 payloads", () => {
    const bytes = dataUrlToBytes("data:image/png;base64,QUJD");
    expect(bytes && Array.from(bytes)).toEqual([65, 66, 67]);
  });

  it("rejects non data URLs", () => {
    expect(dataUrlToBytes("https://example.com/a.png")).toBeNull();
  });
});
