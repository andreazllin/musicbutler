import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// React Compiler, per docs/frontend-structure.md §1.1 (oxc-transform-react).
		react({ compiler: true }),
	],
	resolve: {
		alias: { "@": path.resolve(import.meta.dirname, "./src") },
	},
	server: {
		port: 5173,
		// The same isolation headers as the server sends (apps/server/src/index.ts),
		// so the browser sync can use more than one thread in development too.
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "credentialless",
		},
		// The server owns tRPC, media streaming and /healthz. In dev the Vite
		// server proxies those paths so the app can use same-origin URLs.
		proxy: {
			"/trpc": { target: "http://localhost:3000", changeOrigin: false },
			"/media": { target: "http://localhost:3000", changeOrigin: false },
			"/healthz": { target: "http://localhost:3000", changeOrigin: false },
			"/models": { target: "http://localhost:3000", changeOrigin: false },
		},
	},
	// The browser sync worker imports modules, and ONNX Runtime loads its own
	// files at run time, so it must not be pre-bundled.
	worker: { format: "es" },
	optimizeDeps: { exclude: ["onnxruntime-web", "@huggingface/transformers"] },
	build: { outDir: "dist", sourcemap: true },
});
