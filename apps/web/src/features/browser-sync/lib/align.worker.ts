/// <reference lib="webworker" />
/**
 * The alignment worker of the browser sync (docs/DECISIONS.md, 2026-11-02).
 *
 * It runs the same pipeline as the server's worker (`apps/server/src/sync/
 * worker.ts`), through `@musicbutler/align/browser`: Demucs on onnxruntime-web,
 * wav2vec2 on Transformers.js, then the forced alignment. It runs here and not
 * on the page, because one chunk of Demucs holds the thread for seconds.
 *
 * Models come from IndexedDB (`model-store.ts`), never from the network. The
 * page makes sure they are there before it sends a job. The sessions stay
 * loaded between jobs, because loading costs seconds.
 */
import {
	AbortError,
	AlignError,
	type AsrWindowRunner,
	alignBuffers,
	buildVocab,
	DEMUCS_SEGMENT_SAMPLES,
	type DemucsChunkRunner,
	type TokenizerLike,
	type Vocab,
} from "@musicbutler/align/browser";
import type { BrowserModel, Lang } from "@musicbutler/shared";
import wasmPlainMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmPlain from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import * as ort from "onnxruntime-web/webgpu";
import { modelBaseUrl } from "../constants";
import { readModelFile } from "./model-store";
import type { FromWorker, ToWorker, WorkerStage } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// Serve the ONNX runtime from this app, not from a CDN. Transformers.js only
// sets its CDN paths when none are set, so this has to run before it loads.
//
// The plain build in every browser, never the asyncify build that
// Transformers.js picks outside Safari. The asyncify build has no float64
// kernels, and the inverse STFT at the end of Demucs adds its frames in
// float64: the session fails with "Could not find an implementation for
// ConstantOfShape(9)". Both models run on the CPU here, so nothing needs the
// WebGPU support that the asyncify build adds.
ort.env.wasm.wasmPaths = { mjs: wasmPlainMjs, wasm: wasmPlain };
// More than one thread needs SharedArrayBuffer, which needs cross-origin
// isolation. Leave one core to the page.
ort.env.wasm.numThreads = self.crossOriginIsolated
	? Math.max(1, Math.min(8, (self.navigator.hardwareConcurrency || 2) - 1))
	: 1;

type Asr = { version: string; vocab: Vocab; run: AsrWindowRunner; dispose: () => Promise<void> };
type Demucs = { version: string; run: DemucsChunkRunner; release: () => Promise<void> };

let asr: { lang: Lang; loading: Promise<Asr> } | null = null;
let demucs: Promise<Demucs> | null = null;
const running = new Map<number, AbortController>();

function post(message: FromWorker): void {
	self.postMessage(message);
}

async function blobBytes(model: BrowserModel, name: string): Promise<Uint8Array> {
	const blob = await readModelFile(model.id, name);
	if (!blob) throw new Error(`The browser does not hold ${name}. Download the model again.`);
	return new Uint8Array(await blob.arrayBuffer());
}

async function loadDemucs(model: BrowserModel): Promise<Demucs> {
	const file = model.files[0];
	if (!file) throw new Error("The server lists no file for vocal isolation.");
	const session = await ort.InferenceSession.create(await blobBytes(model, file.name), {
		executionProviders: ["wasm"],
		// The graph holds about 30,000 nodes, and the optimizer runs the
		// WebAssembly heap out of memory (std::bad_alloc) at any level above this.
		graphOptimizationLevel: "disabled",
	});
	const inputName = session.inputNames[0] ?? "mix";
	const outputName = session.outputNames[0] ?? "stems";
	const N = DEMUCS_SEGMENT_SAMPLES;
	return {
		version: model.version,
		run: async (mix) => {
			const out = await session.run({ [inputName]: new ort.Tensor("float32", mix, [1, 2, N]) });
			const stems = out[outputName];
			if (!stems) throw new Error("demucs: missing output tensor");
			const data = (stems.data as Float32Array).slice();
			stems.dispose();
			return data;
		},
		release: () => session.release(),
	};
}

function getDemucs(model: BrowserModel): Promise<Demucs> {
	const current = demucs;
	const next = (async () => {
		if (current) {
			const loaded = await current.catch(() => null);
			if (loaded?.version === model.version) return loaded;
			await loaded?.release();
		}
		return loadDemucs(model);
	})();
	demucs = next;
	next.catch(() => {
		if (demucs === next) demucs = null;
	});
	return next;
}

/**
 * Transformers.js asks its cache for each file before it fetches it. This
 * cache answers from IndexedDB, so the model loads with no network request.
 * It keeps nothing new: `put` does nothing, because the page owns downloads.
 */
function idbCache(prefix: string) {
	return {
		match: async (key: string): Promise<Response | undefined> => {
			if (!key.startsWith(prefix)) return undefined;
			const rest = key.slice(prefix.length);
			const slash = rest.indexOf("/");
			if (slash <= 0) return undefined;
			const id = decodeURIComponent(rest.slice(0, slash)) as BrowserModel["id"];
			const blob = await readModelFile(id, rest.slice(slash + 1));
			if (!blob) return undefined;
			return new Response(blob, { headers: { "content-length": String(blob.size) } });
		},
		put: async () => {},
	};
}

async function loadAsr(model: BrowserModel, lang: Lang): Promise<Asr> {
	const { AutoProcessor, AutoTokenizer, env, Wav2Vec2ForCTC } = await import(
		"@huggingface/transformers"
	);
	const base = modelBaseUrl();
	env.allowRemoteModels = false;
	env.allowLocalModels = true;
	env.localModelPath = base;
	env.useBrowserCache = false;
	env.useWasmCache = false;
	env.useCustomCache = true;
	env.customCache = idbCache(base);

	// The model id is the language: the files sit at /models/<lang>/<file>.
	const processor = await AutoProcessor.from_pretrained(lang);
	const tokenizer = await AutoTokenizer.from_pretrained(lang);
	const model_ = await Wav2Vec2ForCTC.from_pretrained(lang, { dtype: "q8", device: "wasm" });
	const vocab = buildVocab(tokenizer as unknown as TokenizerLike);
	return {
		version: model.version,
		vocab,
		run: async (window) => {
			// The feature extractor normalizes each window (do_normalize=true).
			const inputs = await processor(window);
			const { logits } = (await model_(inputs)) as {
				logits: { dims: number[]; data: Float32Array; dispose: () => void };
			};
			const [, frames = 0, classes = 0] = logits.dims;
			return { data: logits.data, frames, classes, dispose: () => logits.dispose() };
		},
		dispose: async () => {
			await model_.dispose();
		},
	};
}

function getAsr(model: BrowserModel, lang: Lang): Promise<Asr> {
	const current = asr;
	const next = (async () => {
		if (current) {
			const loaded = await current.loading.catch(() => null);
			if (current.lang === lang && loaded?.version === model.version) return loaded;
			// One language at a time: a second model would double the memory.
			await loaded?.dispose();
		}
		return loadAsr(model, lang);
	})();
	asr = { lang, loading: next };
	next.catch(() => {
		if (asr?.loading === next) asr = null;
	});
	return next;
}

async function run(message: Extract<ToWorker, { type: "run" }>): Promise<void> {
	const controller = new AbortController();
	running.set(message.id, controller);
	const { signal } = controller;
	const progress = (stage: WorkerStage, done: number, total: number) =>
		post({ type: "progress", id: message.id, stage, done, total });
	try {
		progress("load", 0, 1);
		const [asrModel, demucsModel] = await Promise.all([
			getAsr(message.asr, message.lang),
			message.separation ? getDemucs(message.separation) : Promise.resolve(null),
		]);
		progress("load", 1, 1);
		if (signal.aborted) throw new AbortError();

		const [left, right] = message.channels;
		if (!left) throw new Error("The audio holds no samples.");
		const result = await alignBuffers({
			stereo44k: right ? [left, right] : [left],
			lyricsText: message.lyrics,
			lang: message.lang,
			vocab: asrModel.vocab,
			asr: asrModel.run,
			demucs: demucsModel?.run,
			signal,
			onProgress: (stage, done, total) => {
				if (stage === "separate" || stage === "align") progress(stage, done, total);
				else if (stage === "emit") progress("transcribe", done, total);
			},
		});
		post({ type: "done", id: message.id, lines: result.lines, words: result.words });
	} catch (err) {
		const text = err instanceof Error ? err.message : String(err);
		const kind =
			err instanceof AbortError || signal.aborted
				? "abort"
				: err instanceof AlignError
					? "align"
					: "internal";
		post({ type: "error", id: message.id, kind, message: text });
	} finally {
		running.delete(message.id);
	}
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	if (message.type === "run") void run(message);
	else running.get(message.id)?.abort();
};
