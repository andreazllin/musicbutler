/**
 * In-memory job store and event emitter for `sync.*` (docs/PLAN.md §6.2).
 *
 * v1 runs one job at a time. A job emits `SyncEvent`s; subscribers receive the
 * latest progress event first (replay) and then the live stream until a
 * terminal `done` or `error` event. `cancel()` aborts the job's signal and
 * closes it with `{ type: "error", code: "CANCELLED" }`; anything the engine
 * emits after that is dropped. Finished jobs are forgotten after `ttlMs`.
 */
import type { Lang, SyncEvent } from "@musicbutler/shared";

export interface JobMeta {
	audioPath: string;
	lang: Lang;
	options?: { isolateVocals?: boolean; leadInMs?: number; wordTimestamps?: boolean };
}

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface Job {
	readonly id: string;
	readonly meta: JobMeta;
	readonly createdAt: number;
	readonly signal: AbortSignal;
	readonly status: JobStatus;
	/** Milliseconds since epoch when the job reached a terminal state, else null. */
	readonly finishedAt: number | null;
	/** Records an event and fans it out. Ignored once the job is terminal. */
	emit(event: SyncEvent): void;
	/** Replays the latest progress event, then streams live events until done/error. */
	subscribe(): AsyncIterable<SyncEvent>;
	/** Aborts the job. Returns false when it had already finished. */
	cancel(): boolean;
}

export interface JobRegistry {
	createJob(meta: JobMeta): Job;
	getJob(id: string): Job | undefined;
	hasRunningJob(): boolean;
	runningJob(): Job | undefined;
	/** Removes every job and clears timers (tests). */
	clear(): void;
}

export const DEFAULT_JOB_TTL_MS = 10 * 60 * 1000;

const CANCELLED_EVENT: SyncEvent = {
	type: "error",
	code: "CANCELLED",
	message: "Cancelled by the user",
};

type Waiter = (value: IteratorResult<SyncEvent>) => void;

/** A single subscriber's mailbox: buffered events plus a pending `next()` resolver. */
class Mailbox {
	private readonly queue: SyncEvent[] = [];
	private waiter: Waiter | null = null;
	private closed = false;

	push(event: SyncEvent): void {
		if (this.closed) return;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	close(): void {
		this.closed = true;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w({ value: undefined, done: true });
		}
	}

	next(): Promise<IteratorResult<SyncEvent>> {
		const queued = this.queue.shift();
		if (queued !== undefined) return Promise.resolve({ value: queued, done: false });
		if (this.closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise<IteratorResult<SyncEvent>>((resolve) => {
			this.waiter = resolve;
		});
	}
}

class JobImpl implements Job {
	readonly id: string;
	readonly meta: JobMeta;
	readonly createdAt = Date.now();
	private readonly controller = new AbortController();
	private _status: JobStatus = "running";
	private _finishedAt: number | null = null;
	private latestProgress: SyncEvent | null = null;
	private terminal: SyncEvent | null = null;
	private readonly subscribers = new Set<Mailbox>();
	private readonly onFinish: (job: JobImpl) => void;

	constructor(id: string, meta: JobMeta, onFinish: (job: JobImpl) => void) {
		this.id = id;
		this.meta = meta;
		this.onFinish = onFinish;
		this.latestProgress = { type: "progress", stage: "queued", pct: 0 };
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	get status(): JobStatus {
		return this._status;
	}

	get finishedAt(): number | null {
		return this._finishedAt;
	}

	emit(event: SyncEvent): void {
		if (this.terminal) return;
		if (event.type === "progress") {
			this.latestProgress = event;
		} else {
			this.terminal = event;
			this._status = event.type === "done" ? "done" : "error";
			this._finishedAt = Date.now();
		}
		for (const m of this.subscribers) m.push(event);
		if (this.terminal) {
			for (const m of this.subscribers) m.close();
			this.subscribers.clear();
			this.onFinish(this);
		}
	}

	cancel(): boolean {
		if (this.terminal) return false;
		this.controller.abort();
		this.emit(CANCELLED_EVENT);
		this._status = "cancelled";
		return true;
	}

	subscribe(): AsyncIterable<SyncEvent> {
		const mailbox = new Mailbox();
		if (this.terminal) {
			mailbox.push(this.terminal);
			mailbox.close();
		} else {
			if (this.latestProgress) mailbox.push(this.latestProgress);
			this.subscribers.add(mailbox);
		}
		const unsubscribe = () => {
			this.subscribers.delete(mailbox);
			mailbox.close();
		};
		return {
			[Symbol.asyncIterator]: () => ({
				next: () => mailbox.next(),
				return: () => {
					unsubscribe();
					return Promise.resolve({ value: undefined, done: true as const });
				},
			}),
		};
	}
}

export function createJobRegistry(opts: { ttlMs?: number } = {}): JobRegistry {
	const ttlMs = opts.ttlMs ?? DEFAULT_JOB_TTL_MS;
	const jobs = new Map<string, JobImpl>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	const onFinish = (job: JobImpl) => {
		const timer = setTimeout(() => {
			jobs.delete(job.id);
			timers.delete(job.id);
		}, ttlMs);
		if (typeof timer === "object" && "unref" in timer) timer.unref();
		timers.set(job.id, timer);
	};

	return {
		createJob(meta) {
			const job = new JobImpl(crypto.randomUUID(), meta, onFinish);
			jobs.set(job.id, job);
			return job;
		},
		getJob(id) {
			return jobs.get(id);
		},
		runningJob() {
			for (const job of jobs.values()) if (job.status === "running") return job;
			return undefined;
		},
		hasRunningJob() {
			return this.runningJob() !== undefined;
		},
		clear() {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
			jobs.clear();
		},
	};
}

/** The process-wide registry used by the `sync.*` procedures. */
export const jobs: JobRegistry = createJobRegistry();
