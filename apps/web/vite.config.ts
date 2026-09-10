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
		// The server owns tRPC, media streaming and /healthz. In dev the Vite
		// server proxies those paths so the app can use same-origin URLs.
		proxy: {
			"/trpc": { target: "http://localhost:3000", changeOrigin: false },
			"/media": { target: "http://localhost:3000", changeOrigin: false },
			"/healthz": { target: "http://localhost:3000", changeOrigin: false },
		},
	},
	build: { outDir: "dist", sourcemap: true },
});
