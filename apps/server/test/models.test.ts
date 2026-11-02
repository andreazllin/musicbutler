import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getEnv } from "../src/env.ts";
import { createApp } from "../src/index.ts";
import { createCaller } from "../src/routers/index.ts";
import { loadAlign } from "../src/sync/engine.ts";
import { makeTempLibrary, type TempLibrary } from "./helpers.ts";

let lib: TempLibrary;
let app: ReturnType<typeof createApp>;
let separationName: string;
const BODY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

beforeAll(async () => {
	lib = makeTempLibrary();
	app = createApp({ serveWeb: false });
	const cacheDir = getEnv().MODEL_CACHE_DIR;
	// Never write a fake model anywhere but the temporary library.
	if (!cacheDir.startsWith(join(lib.dir, ""))) throw new Error(`unsafe cache dir ${cacheDir}`);
	const { modelFileLocations } = await loadAlign();
	const separation = modelFileLocations(cacheDir).separation[0];
	if (!separation) throw new Error("no separation model is configured");
	separationName = separation.name;
	mkdirSync(dirname(separation.path), { recursive: true });
	writeFileSync(separation.path, BODY);
});
afterAll(() => lib.cleanup());

describe("GET /models/<id>/<file>", () => {
	test("serves a file on the list", async () => {
		const res = await app.request(`http://localhost/models/separation/${separationName}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Length")).toBe(String(BODY.length));
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BODY);
	});

	test("answers 304 for a matching ETag", async () => {
		const first = await app.request(`http://localhost/models/separation/${separationName}`);
		const etag = first.headers.get("ETag") ?? "";
		const res = await app.request(`http://localhost/models/separation/${separationName}`, {
			headers: { "If-None-Match": etag },
		});
		expect(res.status).toBe(304);
	});

	test("refuses a file that is not on the list", async () => {
		for (const path of [
			"/models/separation/other.onnx",
			"/models/separation/..%2F..%2Fetc%2Fpasswd",
			"/models/xx-XX/config.json",
			"/models/separation",
			"/models/en-US/onnx/model_quantized.onnx",
		]) {
			const res = await app.request(`http://localhost${path}`);
			expect(res.status, path).toBe(404);
		}
	});

	test("every response carries the cross-origin isolation headers", async () => {
		const res = await app.request("http://localhost/healthz");
		expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
		expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
	});
});

describe("models.browser", () => {
	test("lists the separation model and every language", async () => {
		const { models } = await createCaller({}).models.browser();
		expect(models.map((m) => m.id)).toEqual(["separation", "en-US", "it-IT"]);
		const separation = models[0];
		expect(separation?.available).toBe(true);
		expect(separation?.bytes).toBe(BODY.length);
		expect(separation?.files).toEqual([{ name: separationName, bytes: BODY.length }]);
	});
});
