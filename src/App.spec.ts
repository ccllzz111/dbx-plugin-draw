// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import App from './App.vue';

const bridge = vi.hoisted(() => ({ saveFile: vi.fn(), closeTab: vi.fn(), copy: vi.fn(), readStorage: vi.fn(), writeStorage: vi.fn(), onBeforeTabClose: vi.fn() }));
vi.mock('./host', () => ({ host: {
  ...bridge, isSandbox: true, appearance: 'light', locale: 'en',
  ready: async () => {}, onThemeChange: () => () => {},
} }));
vi.mock('./vfs', () => ({
  createAssetReader: vi.fn(), installVfsShim: () => ({ stats: () => ({}) }),
  readCoreAssets: async () => new Map([['index.html', {}]]), mountDrawio: async () => {},
}));

const original = '<mxGraphModel><root><mxCell id="1" vertex="1"/></root></mxGraphModel>';
const changed = '<mxGraphModel><root/></mxGraphModel>';
let app: VueApp;
async function deliver(event: string, xml?: string, extra = {}) {
  window.dispatchEvent(new MessageEvent('message', { source: window, data: JSON.stringify({ event, xml, ...extra }) }));
  await nextTick();
}
function dirty() { return !!document.querySelector('.dirty'); }

beforeEach(async () => {
  vi.clearAllMocks();
  bridge.readStorage.mockResolvedValue([]);
  bridge.writeStorage.mockResolvedValue(undefined);
  bridge.onBeforeTabClose.mockResolvedValue(() => {});
  bridge.saveFile.mockResolvedValue({ path: 'diagram.drawio' });
  document.body.innerHTML = '<div id="test-app"></div>';
  app = createApp(App);
  app.mount('#test-app');
  await deliver('init');
  await deliver('load', original);
});
afterEach(() => app.unmount());

describe('document save state', () => {
  it('asks before a host tab close and leaves the tab open on cancel', async () => {
    await vi.waitFor(() => expect(bridge.onBeforeTabClose).toHaveBeenCalled());
    await deliver('autosave', changed);
    const close = bridge.onBeforeTabClose.mock.calls[0][0]();
    await nextTick();
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role=alertdialog] button')!.click();
    expect(await close).toBe(false);
  });
  it('keeps the close dialog open when saving is cancelled, then permits discard', async () => {
    await vi.waitFor(() => expect(bridge.onBeforeTabClose).toHaveBeenCalled());
    await deliver('autosave', changed);
    bridge.saveFile.mockResolvedValue(null);
    const close = bridge.onBeforeTabClose.mock.calls[0][0]();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[role=alertdialog] button:nth-child(4)')!.click();
    await vi.waitFor(() => expect(bridge.saveFile).toHaveBeenCalled());
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[role=alertdialog] button:nth-child(3)')!.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('[role=alertdialog] button:nth-child(3)')!.click();
    expect(await close).toBe(true);
  });
  it('persists successful saves and reopens the recorded content', async () => {
    await deliver('save', original);
    await vi.waitFor(() => expect(bridge.writeStorage).toHaveBeenCalled());
    const records = bridge.writeStorage.mock.calls.at(-1)![1];
    expect(records[0]).toMatchObject({ name: 'diagram.drawio', xml: original });
    document.querySelectorAll<HTMLButtonElement>('.mini-bar button')[2].click();
    await nextTick();
    expect(document.querySelector('.recent-file')?.textContent).toContain('diagram.drawio');
    document.querySelector<HTMLButtonElement>('.recent-file')!.click();
    await nextTick();
    expect(dirty()).toBe(false);
  });
  it('does not add cancelled saves to recent history', async () => {
    bridge.saveFile.mockResolvedValue(null);
    await deliver('save', original);
    expect(bridge.writeStorage).not.toHaveBeenCalled();
  });
  it('uses the filename chosen in the host save dialog for recent history', async () => {
    bridge.saveFile.mockResolvedValue({ path: '/diagrams/renamed.drawio' });
    await deliver('save', original);
    await vi.waitFor(() => expect(bridge.writeStorage).toHaveBeenCalled());
    expect(bridge.writeStorage.mock.calls.at(-1)![1][0].name).toBe('renamed.drawio');
  });
  it('marks deletion of the last shape as unsaved', async () => {
    expect(dirty()).toBe(false);
    await deliver('autosave', changed);
    expect(dirty()).toBe(true);
  });
  it('uses an in-page discard dialog, which works without sandbox allow-modals', async () => {
    await deliver('autosave', changed);
    document.querySelector<HTMLButtonElement>('.mini-bar button')!.click();
    await nextTick();
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role=alertdialog] button')!.click();
    await nextTick();
    expect(dirty()).toBe(true);
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
  });
  it('keeps edits and the tab open when save-and-exit is cancelled', async () => {
    bridge.saveFile.mockResolvedValue(null);
    await deliver('save', changed, { exit: true });
    await vi.waitFor(() => expect(bridge.saveFile).toHaveBeenCalled());
    expect(dirty()).toBe(true);
    expect(document.querySelector('.notice')).toBeNull();
    expect(bridge.closeTab).not.toHaveBeenCalled();
  });
  it('does not mark edits made during a pending save as saved', async () => {
    let finish!: (value: unknown) => void;
    bridge.saveFile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await deliver('save', original);
    await deliver('autosave', changed);
    finish({ path: 'diagram.drawio' });
    await nextTick();
    expect(dirty()).toBe(true);
  });
  it('closes only after successful save-and-exit', async () => {
    await deliver('save', changed, { exit: true });
    await vi.waitFor(() => expect(bridge.closeTab).toHaveBeenCalledTimes(1));
    expect(dirty()).toBe(false);
  });
  it('does not use the user clipboard for boot diagnostics', async () => {
    expect(bridge.copy).not.toHaveBeenCalled();
  });
  it('shows an actionable official link inside the sandbox', async () => {
    await deliver('openLink', undefined, { href: 'shortcuts.svg' });
    expect(document.querySelector<HTMLInputElement>('.link-address')?.value).toBe('https://app.diagrams.net/shortcuts.svg');
    expect(document.querySelector('.shortcuts-image')).not.toBeNull();
  });
});
