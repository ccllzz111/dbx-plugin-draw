import { computed, ref } from "vue";
import { host } from "./host";

const dict = {
  en: {
    recentFiles: "Recent files",
    recentHint: "Up to 10 recently imported or saved copies. Reopening loads the recorded copy, not later changes to the original disk file.",
    recentSessionOnly: "History is available in this session only.",
    recentTooLarge: "Saved/imported, but this file is too large for recent history.",
    noRecentFiles: "No recent files",
    removeRecent: "Remove",
    clearRecent: "Clear history",
    saveChanges: "Save changes before continuing?",
    dontSave: "Don't save",
    saveAndContinue: "Save and continue",
    newDiagram: "New",
    importFile: "Import",
    exportDrawio: "Save .drawio",
    exportSvg: "Export .svg",
    exportPng: "Export .png",
    copyXml: "Copy XML",
    fileNameLabel: "File",
    editorTitle: "draw.io diagram editor",
    loadingEditor: "Loading draw.io editor…",
    loadFailed: "Failed to load editor",
    confirmClear: "Discard the current diagram?",
    savedNotice: "Saved",
    copiedNotice: "XML copied to clipboard",
    importedNotice: "Diagram imported",
    importFailed: "Operation failed",
    exitStandalone: "Exit closes the tab inside DBX",
    openLink: "Official documentation / external link",
    externalLinkHint: "DBX cannot open a browser here. Copy this link and open it in your browser.",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    shortcuts: "draw.io keyboard shortcuts",
    close: "Close",
    cancel: "Cancel",
    discard: "Discard",
    statusMock: "standalone preview (no DBX host)",
    statusSandbox: "DBX sandbox · draw.io inside",
    themeLabel: "Theme",
    appearanceLight: "light",
    appearanceDark: "dark",
  },
  "zh-CN": {
    recentFiles: "最近文件",
    recentHint: "保留最近导入或保存的 10 份副本。重新打开的是记录时的内容，不会读取原文件在磁盘上的后续修改。",
    recentSessionOnly: "最近文件仅保留在本次会话中。",
    recentTooLarge: "保存或导入已完成，但文件过大，无法加入最近记录。",
    noRecentFiles: "暂无最近文件",
    removeRecent: "移除",
    clearRecent: "清空记录",
    saveChanges: "继续之前是否保存更改？",
    dontSave: "不保存",
    saveAndContinue: "保存并继续",
    newDiagram: "新建",
    importFile: "导入",
    exportDrawio: "保存 .drawio",
    exportSvg: "导出 .svg",
    exportPng: "导出 .png",
    copyXml: "复制 XML",
    fileNameLabel: "文件",
    editorTitle: "draw.io 图表编辑器",
    loadingEditor: "正在加载 draw.io 编辑器…",
    loadFailed: "编辑器加载失败",
    confirmClear: "确定丢弃当前图表？",
    savedNotice: "已保存",
    copiedNotice: "XML 已复制到剪贴板",
    importedNotice: "图表已导入",
    importFailed: "操作失败",
    exitStandalone: "退出将在 DBX 内关闭标签页",
    openLink: "官方文档 / 外部链接",
    externalLinkHint: "DBX 暂不支持从此处打开浏览器，请复制链接到浏览器访问。",
    copyLink: "复制链接",
    linkCopied: "链接已复制",
    shortcuts: "draw.io 快捷键表",
    close: "关闭",
    cancel: "取消",
    discard: "丢弃更改",
    statusMock: "独立预览（未连接 DBX 宿主）",
    statusSandbox: "DBX 沙箱 · 内置 draw.io",
    themeLabel: "主题",
    appearanceLight: "浅色",
    appearanceDark: "深色",
  },
} as const;

export type LocaleKey = keyof typeof dict;

const localeRef = ref<LocaleKey>(host.locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en");

export function setLocale(value: string): void {
  localeRef.value = value.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function useI18n() {
  return {
    locale: localeRef,
    t: computed(() => dict[localeRef.value]),
  };
}
