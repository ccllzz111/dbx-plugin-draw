<script setup lang="ts">
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
declare const __APP_VERSION__: string | undefined;
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { dataUrlToBytes, DrawioEmbed, emptyDiagramXml, type DrawioMessage } from "./embed";
import { host } from "./host";
import { externalLink, SHORTCUTS_URL } from "./links";
import { RECENT_KEY, parseRecentFiles, rememberFile, type RecentFile } from "./recent";
import { useI18n } from "./i18n";
import { createAssetReader, installVfsShim, mountDrawio, readCoreAssets, type VfsAsset, type VfsHandle } from "./vfs";

const { t, locale } = useI18n();

declare global {
  interface Window {
    // Stashed by the vfs transform when the drawio App instance is created;
    // drives runtime theme (setDarkMode) and toolbar (setCompactMode).
    __dbxUi?: {
      setDarkMode(dark: boolean): void;
      setCompactMode(compact: boolean): void;
      getFileData?(allPages: boolean): string;
      editor?: { graph: { stopEditing(cancel: boolean): void } };
      actions?: { get(name: string): { funct: () => void } | undefined };
    };
  }
}

const fileInput = ref<HTMLInputElement | null>(null);
const embed = shallowRef<DrawioEmbed | null>(null);

const fileName = ref("diagram.drawio");
let documentId: string = crypto.randomUUID();
const recentFiles = ref<RecentFile[]>([]);
const recentOpen = ref(false);
const recentPersistent = ref(true);
const closeGuardAvailable = ref(!host.isSandbox);
const saving = ref(false);
let recentWrite: Promise<void> = Promise.resolve();
const booting = ref(true);
const notice = ref("");
const linkDialog = ref("");
const linkCopied = ref(false);
const confirmDiscard = ref(false);
let resolveDiscard: ((discard: boolean) => void) | undefined;
const appearance = ref(host.appearance);
const bootError = ref("");
const bootStage = ref("");
const bootSlow = ref(false);
const currentXml = ref(emptyDiagramXml());
const savedXml = ref(currentXml.value);

let coreAssets: Map<string, VfsAsset> | null = null;
let vfs: VfsHandle | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let stopThemeListener: (() => void) | undefined;
let stopCloseListener: (() => void) | undefined;
let disposed = false;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 4000);
}

function diag(stage: string, detail?: string): void {
  bootStage.value = detail ? `${stage}: ${detail}` : stage;
  try {
    window.parent?.postMessage({ type: "dbx-draw-diag", stage, detail: detail ?? "" }, "*");
  } catch {
    // parent messaging is best-effort diagnostics only
  }
}

const hasContent = computed(() => /<mxCell[^>]+(vertex|edge)="1"/.test(currentXml.value));
const isDirty = computed(() => currentXml.value !== savedXml.value);

// drawio keeps its native palette; only the light/dark scheme follows the
// DBX appearance (the URL parameter pins it at boot, setDarkMode flips it
// live — dark-mode styling needs CSS light-dark(), Safari 17.5+).
function syncEditorAppearance(): void {
  try {
    window.__dbxUi?.setDarkMode(appearance.value === "dark");
  } catch {
    // theming is cosmetic — never block the editor on this
  }
}

function ensureDrawioName(): string {
  return fileName.value.endsWith(".drawio") ? fileName.value : `${fileName.value}.drawio`;
}

function flushEditor(): void {
  window.__dbxUi?.editor?.graph.stopEditing(false);
  const xml = window.__dbxUi?.getFileData?.(true);
  if (xml) currentXml.value = xml;
}

async function persistRecent(next: RecentFile[]): Promise<void> {
  recentFiles.value = next;
  const snapshot = JSON.parse(JSON.stringify(next));
  const write = recentWrite.catch(() => {}).then(() => host.writeStorage(RECENT_KEY, snapshot));
  recentWrite = write;
  try { await write; recentPersistent.value = true; }
  catch { recentPersistent.value = false; }
}

async function rememberDocument(id: string, name: string, xml: string): Promise<void> {
  try {
    await persistRecent(rememberFile(recentFiles.value, { id, name, xml, openedAt: Date.now() }));
  } catch {
    showNotice(t.value.recentTooLarge);
  }
}

async function openRecent(file: RecentFile): Promise<void> {
  if (!await allowDiscard()) return;
  documentId = file.id;
  fileName.value = file.name;
  currentXml.value = savedXml.value = file.xml;
  embed.value?.loadXml(file.xml);
  recentOpen.value = false;
  await rememberDocument(file.id, file.name, file.xml);
}

async function exportDrawio(): Promise<boolean> {
  if (saving.value) return false;
  flushEditor();
  const xml = currentXml.value;
  const id = documentId;
  const name = ensureDrawioName();
  saving.value = true;
  try {
    const bytes = new TextEncoder().encode(xml);
    const result = await host.saveFile({ fileName: name, contentType: "application/xml" }, bytes.buffer as ArrayBuffer);
    if (result == null) return false; // Native save dialog was cancelled.
    const path = (result as { path?: unknown }).path;
    const savedName = typeof path === "string" ? path.split(/[\\/]/).pop() || name : name;
    if (id === documentId) {
      flushEditor();
      savedXml.value = xml; // Do not mark edits made during the save as saved.
      fileName.value = savedName;
      if (!isDirty.value) embed.value?.send({ action: "status", modified: false });
    }
    showNotice(t.value.savedNotice);
    await rememberDocument(id, savedName, xml);
    return true;
  } catch (error) {
    showNotice(`${t.value.importFailed}: ${error instanceof Error ? error.message : error}`);
    return false;
  } finally {
    saving.value = false;
  }
}

async function exportPng(): Promise<void> {
  if (!embed.value) return;
  try {
    const reply = await embed.value.exportImage("png", { border: 16 });
    const bytes = dataUrlToBytes(typeof reply.data === "string" ? reply.data : "");
    if (!bytes) {
      showNotice(t.value.importFailed);
      return;
    }
    if (typeof reply.xml === "string" && reply.xml) currentXml.value = reply.xml;
    const pngName = `${ensureDrawioName().replace(/\.drawio$/, "")}.png`;
    const result = await host.saveFile({ fileName: pngName, contentType: "image/png" }, bytes.buffer as ArrayBuffer);
    if (result != null) showNotice(t.value.savedNotice);
  } catch (error) {
    showNotice(`${t.value.importFailed}: ${error instanceof Error ? error.message : error}`);
  }
}

async function exportSvg(): Promise<void> {
  if (!embed.value) return;
  try {
    const reply = await embed.value.exportImage("svg", { border: 8 });
    if (typeof reply.xml === "string" && reply.xml) currentXml.value = reply.xml;
    const dataUrl = typeof reply.data === "string" && reply.data.startsWith("data:") ? reply.data : null;
    const bytes = dataUrl
      ? dataUrlToBytes(dataUrl)
      : new TextEncoder().encode(typeof reply.data === "string" && reply.data ? reply.data : (reply.svg ?? ""));
    if (!bytes?.length) {
      showNotice(t.value.importFailed);
      return;
    }
    const svgName = `${ensureDrawioName().replace(/\.drawio$/, "")}.svg`;
    const result = await host.saveFile({ fileName: svgName, contentType: "image/svg+xml" }, bytes.buffer as ArrayBuffer);
    if (result != null) showNotice(t.value.savedNotice);
  } catch (error) {
    showNotice(`${t.value.importFailed}: ${error instanceof Error ? error.message : error}`);
  }
}

async function copyXml(): Promise<void> {
  await host.copy(currentXml.value);
  showNotice(t.value.copiedNotice);
}

function allowDiscard(): Promise<boolean> {
  flushEditor();
  if (!isDirty.value) return Promise.resolve(true);
  if (resolveDiscard) return Promise.resolve(false);
  confirmDiscard.value = true;
  return new Promise(resolve => { resolveDiscard = resolve; });
}

async function saveBeforeContinuing(): Promise<void> {
  if (await exportDrawio() && !isDirty.value) answerDiscard(true);
}

function answerDiscard(discard: boolean): void {
  confirmDiscard.value = false;
  resolveDiscard?.(discard);
  resolveDiscard = undefined;
}

async function newDiagram(): Promise<void> {
  if (!await allowDiscard()) return;
  documentId = crypto.randomUUID();
  currentXml.value = emptyDiagramXml();
  savedXml.value = currentXml.value;
  fileName.value = "diagram.drawio";
  embed.value?.loadXml(currentXml.value);
}

async function readDroppedOrPickedFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror") || !["mxfile", "mxGraphModel"].includes(doc.documentElement.nodeName)) {
      throw new Error("Not a drawio XML document");
    }
    if (!await allowDiscard()) return;
    documentId = crypto.randomUUID();
    currentXml.value = text;
    savedXml.value = text;
    fileName.value = file.name.endsWith(".drawio") ? file.name : `${file.name}.drawio`;
    embed.value?.loadXml(text);
    showNotice(t.value.importedNotice);
    await rememberDocument(documentId, fileName.value, text);
  } catch (error) {
    showNotice(`${t.value.importFailed}: ${error instanceof Error ? error.message : error}`);
  }
}

function onDrop(event: DragEvent): void {
  const file = event.dataTransfer?.files?.[0];
  if (file) void readDroppedOrPickedFile(file);
}

function onPickChange(input: HTMLInputElement): void {
  const file = input.files?.[0];
  if (file) void readDroppedOrPickedFile(file);
  input.value = "";
}

function onEvent(message: DrawioMessage): void {
  // saveAndExit mode: Ctrl+S inside drawio asks us to persist.
  if (message.event === "save") {
    void exportDrawio().then((saved) => {
      if (saved && message.exit && !isDirty.value) closeEditor();
    });
  }
  if (message.event === "openLink") {
    const url = externalLink(message.href);
    if (url) {
      const opened = host.isSandbox ? null : window.open(url, "_blank");
      if (opened) opened.opener = null;
      else {
        linkDialog.value = url;
        linkCopied.value = false;
      }
    }
  }
  // drawio's own Exit button (embed mode): drawio has already confirmed
  // unsaved changes on its side; close the workbench tab like the host's ⌘W.
  // Outside DBX there is nothing to close — say so instead of a dead button.
  if (message.event === "exit") {
    closeEditor();
  }
}

function closeEditor(): void {
  if (host.isSandbox && closeGuardAvailable.value) host.closeTab();
  else if (host.isSandbox) void allowDiscard().then(allowed => { if (allowed) host.closeTab(); });
  else showNotice(t.value.exitStandalone);
}

async function copyLink(): Promise<void> {
  try {
    linkCopied.value = (await host.copy(linkDialog.value)).success;
  } catch (error) {
    showNotice(`${t.value.importFailed}: ${error instanceof Error ? error.message : error}`);
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (isDirty.value) { event.preventDefault(); event.returnValue = ""; }
}

onMounted(async () => {
  window.addEventListener("beforeunload", onBeforeUnload);
  const slowTimer = window.setTimeout(() => (bootSlow.value = true), 3000);

  // The embed listener must exist before drawio boots: its one-shot init
  // message is lost otherwise.
  embed.value = new DrawioEmbed({
    onReady: () => {
      booting.value = false;
      clearTimeout(slowTimer);
      diag("drawio-init");
      embed.value?.loadXml(currentXml.value);
      diag("load-sent");
      // Embed mode auto-collapses the toolbar on short screens; the classic
      // full drawio look is what users expect, so always expand it.
      try {
        window.__dbxUi?.setCompactMode(false);
        const exit = window.__dbxUi?.actions?.get('exit');
        if (exit) exit.funct = closeEditor;
      } catch {
        // cosmetic only — never block the editor on this
      }
    },
    onXml: (xml, source) => {
      currentXml.value = xml;
      if (source === "load") {
        const normalized = window.__dbxUi?.getFileData?.(true) || xml;
        currentXml.value = savedXml.value = normalized;
        diag("drawio-loaded");
      }
    },
    onEvent,
  });

  // Debug/verification hook for automated tests and manual inspection.
  (window as unknown as Record<string, unknown>).__dbxDraw = {
    embed: embed.value,
    isDirty: () => isDirty.value,
    hasContent: () => hasContent.value,
    vfsStats: () => vfs?.stats() ?? null,
    get xml() {
      return currentXml.value;
    },
  };

  try {
    // The srcdoc document may start executing before the host page has
    // created its message bridge (WKWebView parses srcdoc eagerly); requests
    // posted in that window are dropped. Waiting for the SDK handshake
    // guarantees the bridge listener exists before our first readAsset.
    diag("wait-bridge");
    await host.ready();
    await Promise.all([
      host.onBeforeTabClose(allowDiscard).then(stop => {
        if (disposed) stop();
        else { stopCloseListener = stop; closeGuardAvailable.value = true; }
      }).catch(() => { closeGuardAvailable.value = false; }),
      host.readStorage(RECENT_KEY).then(value => { recentFiles.value = parseRecentFiles(value); })
        .catch(() => { recentPersistent.value = false; }),
    ]);
    if (disposed) return;
    const reader = createAssetReader();
    diag("core-start");
    coreAssets = await readCoreAssets(reader);
    diag("core-done", `${coreAssets.size} files`);
    if (!coreAssets.has("index.html")) throw new Error("drawio/index.html not readable via host bridge");
    vfs = installVfsShim(reader, (message) => diag("vfs", message));
    await mountDrawio(coreAssets, {
      lang: locale.value === "zh-CN" ? "zh" : "en",
      dark: appearance.value === "dark",
    });
    diag("mounted");
    // Regression guard: if anything navigates this document away again, the
    // diagnostics channel reports it immediately.
    window.addEventListener("pagehide", () => diag("pagehide"));
    window.addEventListener("unload", () => diag("unload"));
  } catch (error) {
    bootError.value = error instanceof Error ? error.message : String(error);
    diag("boot-error", bootError.value);
  }

  stopThemeListener = host.onThemeChange(() => {
    // Follow the DBX light/dark scheme live: drawio switches via its runtime
    // dark-mode API (the URL parameter only applies at boot).
    appearance.value = host.appearance;
    syncEditorAppearance();
  });
});

onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("beforeunload", onBeforeUnload);
  if (noticeTimer) clearTimeout(noticeTimer);
  stopThemeListener?.();
  stopCloseListener?.();
  answerDiscard(false);
  embed.value?.dispose();
  embed.value = null;
});
</script>

<template>
  <!-- drawio mounts into <body> next to this root; only fixed-position chrome here -->
  <div class="app-chrome" @dragover.prevent @drop.prevent="onDrop">
    <div v-if="booting && !bootError" class="boot-overlay">
      <div class="spinner"></div>
      <p>{{ t.loadingEditor }}</p>
      <p class="boot-version">v{{ APP_VERSION }}</p>
      <p v-if="bootSlow" class="boot-stage">{{ bootStage || "…" }}</p>
    </div>
    <div v-if="bootError" class="boot-overlay">
      <p class="boot-error">{{ t.loadFailed }}: {{ bootError }}</p>
    </div>

    <div v-if="!booting" class="mini-bar">
      <span class="brand-dot" aria-hidden="true"></span>
      <button class="chip" type="button" :title="t.newDiagram" @click="newDiagram">{{ t.newDiagram }}</button>
      <button class="chip" type="button" :title="t.importFile" @click="fileInput?.click()">{{ t.importFile }}</button>
      <button class="chip" type="button" @click="recentOpen = true">{{ t.recentFiles }}</button>
      <button class="chip primary" type="button" :disabled="saving" :title="t.exportDrawio" @click="exportDrawio">{{ t.exportDrawio }}</button>
      <button class="chip" type="button" :title="t.exportPng" @click="exportPng">PNG</button>
      <button class="chip" type="button" :title="t.exportSvg" @click="exportSvg">SVG</button>
      <button class="chip" type="button" :title="t.copyXml" @click="copyXml">{{ t.copyXml }}</button>
      <span v-if="isDirty" class="dirty">●</span>
      <span v-if="notice" class="notice">{{ notice }}</span>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".drawio,.xml,application/xml,text/xml"
      class="hidden-input"
      @change="fileInput && onPickChange(fileInput)"
    />
    <div v-if="linkDialog" class="link-backdrop" @click.self="linkDialog = ''">
      <section class="link-dialog" role="dialog" aria-modal="true" :aria-label="t.openLink">
        <button class="chip" @click="linkDialog = ''">{{ t.close }}</button>
        <p>{{ t.externalLinkHint }}</p>
        <input class="link-address" :value="linkDialog" readonly :aria-label="t.openLink" @focus="($event.target as HTMLInputElement).select()" />
        <button class="chip" @click="copyLink">{{ linkCopied ? t.linkCopied : t.copyLink }}</button>
        <img v-if="linkDialog === SHORTCUTS_URL" :src="'shortcuts.svg'" :alt="t.shortcuts" class="shortcuts-image" />
      </section>
    </div>
    <div v-if="confirmDiscard" class="link-backdrop confirm-backdrop">
      <section class="link-dialog" role="alertdialog" aria-modal="true" :aria-label="t.saveChanges">
        <p>{{ t.saveChanges }} {{ fileName }}</p>
        <button class="chip" :disabled="saving" @click="answerDiscard(false)">{{ t.cancel }}</button>
        <button class="chip" :disabled="saving" @click="answerDiscard(true)">{{ t.dontSave }}</button>
        <button class="chip primary" :disabled="saving" @click="saveBeforeContinuing">{{ t.saveAndContinue }}</button>
      </section>
    </div>
    <div v-if="recentOpen" class="link-backdrop" @click.self="recentOpen = false">
      <section class="link-dialog recent-dialog" role="dialog" aria-modal="true" :aria-label="t.recentFiles">
        <h3>{{ t.recentFiles }}</h3>
        <p>{{ t.recentHint }}</p>
        <p v-if="!recentPersistent">{{ t.recentSessionOnly }}</p>
        <p v-if="!recentFiles.length">{{ t.noRecentFiles }}</p>
        <ul class="recent-list">
          <li v-for="file in recentFiles" :key="file.id">
            <button class="recent-file" @click="openRecent(file)">{{ file.name }}<small>{{ new Date(file.openedAt).toLocaleString(locale) }}</small></button>
            <button class="chip" :aria-label="`${t.removeRecent}: ${file.name}`" @click="persistRecent(recentFiles.filter(entry => entry.id !== file.id))">{{ t.removeRecent }}</button>
          </li>
        </ul>
        <button class="chip" :disabled="!recentFiles.length" @click="persistRecent([])">{{ t.clearRecent }}</button>
        <button class="chip" @click="recentOpen = false">{{ t.close }}</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop { z-index: 1; }
.recent-dialog { width: 520px; }
.recent-list { padding: 0; list-style: none; }
.recent-list li { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
.recent-file { flex: 1; min-width: 0; text-align: left; cursor: pointer; border: 0; border-radius: 6px; padding: 10px; color: inherit; background: var(--color-muted, #f4f4f5); overflow-wrap: anywhere; }
.recent-file small { display: block; opacity: .65; margin-top: 4px; }
.chip:disabled { opacity: .5; cursor: default; }
.link-backdrop { position: fixed; inset: 0; background: #0006; display: grid; place-items: center; pointer-events: all; }
.link-dialog { max-width: 90vw; max-height: 85vh; overflow: auto; padding: 20px; background: var(--color-card, white); color: var(--color-foreground, black); border-radius: 12px; }
.link-address { display: block; width: 100%; min-width: 280px; box-sizing: border-box; margin: 12px 0; }
.shortcuts-image { display: block; width: 1000px; max-width: 100%; margin-top: 16px; background: white; }
.app-chrome {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1000;
}

.boot-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--color-background, #fafafa);
  font-size: 13px;
  color: var(--color-muted-foreground, #71717a);
  pointer-events: all;
}

.boot-version {
  font-size: 11px;
  opacity: 0.7;
}

.boot-stage {
  font-size: 11px;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.boot-error {
  color: var(--color-danger, #dc2626);
  max-width: 80%;
  text-align: center;
}

.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--color-border, #d4d4d8);
  border-top-color: var(--color-primary, #2563eb);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.mini-bar {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border, #d4d4d8);
  background: var(--color-card, #ffffff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  pointer-events: all;
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--color-primary, #2563eb);
}

.chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border, #d4d4d8);
  background: var(--color-background, #ffffff);
  color: var(--color-foreground, #18181b);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.chip:hover {
  background: var(--color-muted, #f4f4f5);
}

.chip.primary {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary, #2563eb);
  color: var(--color-primary-foreground, #ffffff);
}

.dirty {
  color: var(--color-primary, #2563eb);
}

.notice {
  color: var(--color-primary, #2563eb);
  font-size: 12px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-input {
  display: none;
}
</style>
