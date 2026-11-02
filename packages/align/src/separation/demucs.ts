/**
 * HTDemucs vocals separation through onnxruntime-node
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.4).
 *
 * No external mean/std normalization: the ONNX graph normalizes internally.
 * No random shifts (§7.12): the output is deterministic.
 */
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import { CACHE_DIR, DEMUCS_SEGMENT_SAMPLES, MODELS } from "../config.ts";
import { ensureFile, fileReady } from "../models/download.ts";
import { throwIfAborted } from "../types.ts";
import { type SeparateOptions, separateVocalsWith } from "./separate.ts";

export type { SeparateOptions } from "./separate.ts";

export const DEMUCS_MODEL_PATH = join(CACHE_DIR, MODELS.demucs.file);

export interface DemucsLoadOptions {
	modelPath?: string;
	/** ORT intraOpNumThreads. Default: ORT's default. */
	threads?: number;
	onDownload?: (receivedBytes: number, totalBytes: number) => void;
	signal?: AbortSignal;
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
	separateVocals(
		stereo: [Float32Array, Float32Array] | [Float32Array],
		opts: SeparateOptions = {},
	): Promise<[Float32Array, Float32Array]> {
		const N = DEMUCS_SEGMENT_SAMPLES;
		return separateVocalsWith(
			async (mix) => {
				const out = await this.session.run({
					[this.inputName]: new ort.Tensor("float32", mix, [1, 2, N]),
				});
				const stems = out[this.outputName];
				if (!stems) throw new Error("demucs: missing output tensor");
				return stems.data as Float32Array;
			},
			stereo,
			opts,
		);
	}
}
