#!/usr/bin/env bun
/**
 * `bun run dev`: start the server and Vite side by side (docs/PLAN.md §9.5).
 *
 * `bun run --filter … dev` cannot do this: it runs workspace scripts in
 * dependency order, and `@musicbutler/web` depends on `@musicbutler/server`, so
 * Vite would wait forever for the server's watch process to exit.
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const children = [
	Bun.spawn(["bun", "run", "dev"], {
		cwd: join(root, "apps/server"),
		stdio: ["inherit", "inherit", "inherit"],
	}),
	Bun.spawn(["bun", "run", "dev"], {
		cwd: join(root, "apps/web"),
		stdio: ["inherit", "inherit", "inherit"],
	}),
];

const stop = () => {
	for (const c of children) c.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// If one side exits, stop the other and propagate the exit code.
const code = await Promise.race(children.map((c) => c.exited));
stop();
process.exit(code);
