import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __APP_VERSION__: JSON.stringify((globalThis as any).process?.env?.npm_package_version ?? "dev"),
  },
  plugins: [
    vue(),
    // The DBX dev host reloads plugin pages only after this marker line.
    { name: "dbx-build-signal", closeBundle() { console.log("DBX_UI_BUILD_SUCCESS"); } },
  ],
  base: "./",
  build: { outDir: "ui", emptyOutDir: true },
});
