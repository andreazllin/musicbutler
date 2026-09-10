/**
 * HTDemucs vocals separation through onnxruntime-node
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.4).
 *
 * No external mean/std normalization: the ONNX graph normalizes internally.
 * No random shifts (§7.12): the output is deterministic.
 */
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import { padTo } from "../audio/ops.ts";
import {
	CACHE_DIR,
	DEMUCS_OVERLAP,
	DEMUCS_SEGMENT_SAMPLES,
	DEMUCS_VOCALS_INDEX,
	MODELS,
} from "../config.ts";
import { ensureFile, fileReady } from "../models/download.ts";
import { throwIfAborted } from "../types.ts";
import { type Chunk, makeWindow, OverlapAdd, planChunks } from "./chunking.ts";

export const DEMUCS_MODEL_PATH = join(CACHE_DIR, MODELS.demucs.file);

export interface DemucsLoadOptions {
	modelPath?: string;
	/** ORT intraOpNumThreads. Default: ORT's default. */
	threads?: number;
	onDownload?: (receivedBytes: number, totalBytes: number) => void;
	signal?: AbortSignal;
}

export interface SeparateOptions {
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
	/** Lets tests inspect the overlap-add weights. */
	onWeights?: (weights: Float32Array) => void;
}

/** True when the Demucs weights are in the cache. No network. */
export function demucsReady(modelPath = DEMUCS_MODEL_PATH): Promise<boolean> {
	return fileReady(modelPath, MODELS.demucs.bytes);
}

export async function ensureDemucs(opts: DemucsLoadOptions = {}): Promise<string> {
	const path = opts.modelPath ?? DEMUCS_MODEL_PATH;
	await ensureFile(MODELS.demucs.url, path, {
		expectedBytes: opts.modelPath ? undefined : MODELS.demucs.bytes,
		onProgress: opts.onDownload,
		signal: opts.signal,
	});
	return path;
}

export class DemucsSeparator {
	private constructor(
		private readonly session: ort.InferenceSession,
		readonly inputName: string,
		readonly outputName: string,
	) {}

	static async load(opts: DemucsLoadOptions = {}): Promise<DemucsSeparator> {
		const path = await ensureDemucs(opts);
		throwIfAborted(opts.signal);
		const sessionOpts: ort.InferenceSession.SessionOptions = {
			executionProviders: ["cpu"],
			graphOptimizationLevel: "all",
		};
		if (opts.threads !== undefined) sessionOpts.intraOpNumThreads = opts.threads;
		const session = await ort.InferenceSession.create(path, sessionOpts);
		const inputName = session.inputNames[0] ?? "mix";
		const outputName = session.outputNames[0] ?? "stems";
		return new DemucsSeparator(session, inputName, outputName);
	}

	async release(): Promise<void> {
		await this.session.release();
	}

	/**
	 * Input: stereo 44.1 kHz (a mono input is duplicated). Output: vocals [L, R]
	 * of the same length. Fires `onProgress` once per chunk and honours `signal`
	 * between chunks.
	 */
	async separateVocals(
		stereo: [Float32Array, Float32Array] | [Float32Array],
		opts: SeparateOptions = {},
	): Promise<[Float32Array, Float32Array]> {
		const L = stereo[0];
		const R = stereo[1] ?? stereo[0];
		if (L.length !== R.length) throw new Error("demucs: channel length mismatch");
		const total = L.length;
		const N = DEMUCS_SEGMENT_SAMPLES;
		const chunks = planChunks(total, N, DEMUCS_OVERLAP);
		const ola = new OverlapAdd(2, total, makeWindow(N, DEMUCS_OVERLAP), DEMUCS_OVERLAP);
		const mix = new Float32Array(2 * N);
		opts.onProgress?.(0, chunks.length);
		for (let i = 0; i < chunks.length; i++) {
			throwIfAborted(opts.signal);
			const { start, end } = chunks[i] as Chunk;
			const clen = end - start;
			// [1, 2, N] channel-major: L then R, zero-padded tail.
			mix.set(padTo(L.subarray(start, end), N), 0);
			mix.set(padTo(R.subarray(start, end), N), N);
			const out = await this.session.run({
				[this.inputName]: new ort.Tensor("float32", mix, [1, 2, N]),
			});
			const stems = out[this.outputName];
			if (!stems) throw new Error("demucs: missing output tensor");
			const d = stems.data as Float32Array;
			// Layout [4][2][N]: element (s, c, i) at ((s*2)+c)*N + i (§7.3).
			const lOff = (DEMUCS_VOCALS_INDEX * 2 + 0) * N;
			const rOff = (DEMUCS_VOCALS_INDEX * 2 + 1) * N;
			ola.add(start, end, [d.subarray(lOff, lOff + clen), d.subarray(rOff, rOff + clen)]);
			opts.onProgress?.(i + 1, chunks.length);
		}
		opts.onWeights?.(ola.weights());
		const [vl, vr] = ola.finish();
		return [vl as Float32Array, vr as Float32Array];
	}
}
