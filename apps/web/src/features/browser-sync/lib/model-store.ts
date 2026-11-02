/**
 * The browser's copy of the sync models, in IndexedDB (docs/DECISIONS.md,
 * 2026-11-02).
 *
 * IndexedDB rather than Cache Storage: a self-hosted server is often reached
 * over plain HTTP on a home network, and Cache Storage exists only on HTTPS
 * and localhost. IndexedDB exists everywhere, and in a Web Worker too, so the
 * page downloads and the worker reads through this one module.
 *
 * Two object stores. `files` holds one Blob per model file. `models` holds one
 * record per complete model, written only after its last file, so a download
 * that stops halfway never looks ready.
 */
import type { BrowserModel, BrowserModelId } from "@musicbutler/shared";
import { modelFileUrl } from "../constants";
import type { ModelRecord } from "../helpers/local-state";

const DB_NAME = "musicbutler-models";
const DB_VERSION = 1;
const FILES = "files";
const MODELS = "models";

type FileRecord = { key: string; blob: Blob };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "key" });
			if (!db.objectStoreNames.contains(MODELS)) db.createObjectStore(MODELS, { keyPath: "id" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error ?? new Error("The browser could not open its model storage."));
		};
	});
	return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function committed(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("The browser stopped the write."));
	});
}

function fileKey(id: BrowserModelId, name: string): string {
	return `${id}/${name}`;
}

/** Every complete model this browser holds. */
export async function listLocalModels(): Promise<ModelRecord[]> {
	const db = await openDb();
	return done(db.transaction(MODELS).objectStore(MODELS).getAll() as IDBRequest<ModelRecord[]>);
}

/** One file of a model, or null when the browser does not hold it. */
export async function readModelFile(id: BrowserModelId, name: string): Promise<Blob | null> {
	const db = await openDb();
	const record = await done(
		db.transaction(FILES).objectStore(FILES).get(fileKey(id, name)) as IDBRequest<
			FileRecord | undefined
		>,
	);
	return record?.blob ?? null;
}

/** Removes a model and every file it has. */
export async function deleteLocalModel(model: Pick<BrowserModel, "id" | "files">): Promise<void> {
	const db = await openDb();
	const tx = db.transaction([FILES, MODELS], "readwrite");
	tx.objectStore(MODELS).delete(model.id);
	// Also clear files that an older version of the model had under other names.
	const files = tx.objectStore(FILES);
	files.delete(IDBKeyRange.bound(`${model.id}/`, `${model.id}/￿`));
	await committed(tx);
}

export type DownloadProgress = { received: number; total: number };

/**
 * Downloads every file of `model` from the server and stores it. Progress
 * counts bytes over the whole model. The model record is written last, so
 * only a complete download reads as ready. An abort through `signal` leaves
 * the model missing.
 */
export async function downloadModel(
	model: BrowserModel,
	onProgress: (progress: DownloadProgress) => void,
	signal: AbortSignal,
): Promise<void> {
	await deleteLocalModel(model);
	const total = model.bytes;
	let received = 0;
	onProgress({ received, total });
	for (const file of model.files) {
		const response = await fetch(modelFileUrl(model.id, file.name), {
			signal,
			cache: "no-store",
			credentials: "include",
		});
		if (!response.ok || !response.body) {
			throw new Error(`The server answered ${response.status} for ${file.name}.`);
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let fileBytes = 0;
		for (;;) {
			const { done: finished, value } = await reader.read();
			if (finished) break;
			chunks.push(value);
			fileBytes += value.byteLength;
			received += value.byteLength;
			onProgress({ received, total });
		}
		if (fileBytes !== file.bytes) {
			throw new Error(`${file.name} ended at ${fileBytes} bytes. The server listed ${file.bytes}.`);
		}
		const db = await openDb();
		const tx = db.transaction(FILES, "readwrite");
		const record: FileRecord = { key: fileKey(model.id, file.name), blob: new Blob(chunks) };
		tx.objectStore(FILES).put(record);
		await committed(tx);
	}
	const db = await openDb();
	const tx = db.transaction(MODELS, "readwrite");
	const record: ModelRecord = {
		id: model.id,
		version: model.version,
		bytes: model.bytes,
		savedAt: Date.now(),
	};
	tx.objectStore(MODELS).put(record);
	await committed(tx);
}
