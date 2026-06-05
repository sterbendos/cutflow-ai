import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // 1. prevent vite from obscuring rust errors
  clearScreen: false,

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // These headers enable SharedArrayBuffer which ONNX Runtime WASM requires for Whisper.
    // Without COOP + COEP, WebView2 refuses to expose SharedArrayBuffer even with numThreads=1.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // onnxruntime-web ships pre-built WASM binaries and must not be re-bundled.
  // Excluding it prevents Vite from trying to parse its WASM internals.
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
});

