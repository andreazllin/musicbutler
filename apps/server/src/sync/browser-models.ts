/**
 * The models a browser downloads to run a sync itself (docs/DECISIONS.md,
 * 2026-11-02).
 *
 * The browser fetches them from this server, not from Hugging Face: the server
 * already holds them, a self-hosted library may have no route to the internet,
 * and the browser then runs exactly the model the server would. A model the
 * server lacks is listed as unavailable.
 *
 * Only the files that `modelFileLocations` names can be served. A request
 * names a model id and a file name, and both must match that list exactly.
 */
import { type BrowserModel, type BrowserModelId, LANGS, type Lang } from "@musicbutler/shared";
import { getEnv } from "../env.ts";
import { statModelFile } from "../fs/models.ts";
import { loadAlign } from "./engine.ts";

type Location = { name: string; path: string };

async function locations(): Promise<Map<BrowserModelId, Location[]>> {
	const { modelFileLocations } = await loadAlign();
	const all = modelFileLocations(getEnv().MODEL_CACHE_DIR);
	const out = new Map<BrowserModelId, Location[]>([["separation", all.separation]]);
	for (const lang of LANGS) {
		const files = all.asr[lang];
		if (files) out.set(lang, files);
	}
	return out;
}

/** Every model the browser could need, with sizes, in a stable order. */
export async function listBrowserModels(): Promise<BrowserModel[]> {
	const byId = await locations();
	const ids: BrowserModelId[] = ["separation", ...LANGS];
	return Promise.all(
		ids.map(async (id) => {
			const files = byId.get(id) ?? [];
			const stats = await Promise.all(files.map((f) => statModelFile(f.path)));
			const available = files.length > 0 && stats.every((s) => s !== null);
			return {
				id,
				files: files.map((f, i) => ({ name: f.name, bytes: stats[i]?.bytes ?? 0 })),
				bytes: stats.reduce((sum, s) => sum + (s?.bytes ?? 0), 0),
				available,
				version: stats.map((s) => (s ? `${s.bytes}-${Math.trunc(s.mtimeMs)}` : "-")).join("."),
			};
		}),
	);
}

/** The absolute path of one served file, or null when the pair is not on the list. */
export async function resolveBrowserModelFile(id: string, name: string): Promise<string | null> {
	const files = (await locations()).get(id as "separation" | Lang);
	return files?.find((f) => f.name === name)?.path ?? null;
}
