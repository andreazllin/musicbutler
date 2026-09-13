/**
 * In-memory job queue and event emitter for `sync.*` and `jobs.*`
 * (docs/PLAN.md §6.2).
 *
 * A job is created `queued` and joins a FIFO. One job runs at a time: the
 * models hold hundreds of megabytes and saturate the CPU, so a second parallel
 * run would make both slower and could exhaust the memory of a small host. When
 * the running job reaches a terminal state the queue starts the next one.
 *
 * A job emits `SyncEvent`s; subscribers receive the latest progress event first
 * (replay) and then the live stream until a terminal `done` or `error` event.
 * `cancel()` works on a queued job as well as a running one: it aborts the
 * job's signal and closes it with `{ type: "error", code: "CANCELLED" }`, and
 * anything the engine emits after that is dropped. Finished jobs are forgotten
 * after `ttlMs`.
 *
 * `subscribeList()` streams a snapshot of the whole queue on every change. It
 * coalesces, so a subscriber that reads slower than the 2 s heartbeat sees the
 * newest snapshot rather than a backlog of stale ones.
 */
import type { JobStatus, JobSummary, Lang, SyncEvent } from "@musicbutler/shared";

type ProgressEvent = Extract<SyncEvent, { type: "progress" }>;

export interface JobMeta {
	audioPath: string;
	lang: Lang;
	options?: { isolateVocals?: boolean; leadInMs?: number; wordTimestamps?: boolean };
}

export type { JobStatus };

export interface Job {
	readonly id: string;
	readonly meta: JobMeta;
	readonly createdAt: number;
	readonly signal: AbortSignal;
	readonly status: JobStatus;
	/** Milliseconds since epoch when the queue started the job, else null. */
	readonly startedAt: number | null;
	/** Milliseconds since epoch when the job reached a terminal state, else null. */
	readonly finishedAt: number | null;
	/** Records an event and fans it out. Ignored once the job is terminal. */
	emit(event: SyncEvent): void;
	/** Replays the latest progress event, then streams live events until done/error. */
	subscribe(): AsyncIterable<SyncEvent>;
	/** Aborts the job. Returns false when it had already finished. */
	cancel(): boolean;
	/** The row `jobs.list` returns. */
	summary(): JobSummary;
}

/** Called by the queue when a job reaches the front and may start work. */
export type JobRunner = (job: Job) => void;

export interface JobRegistry {
	/** Queues a job. `run` is called once the job reaches the front of the queue. */
	createJob(meta: JobMeta, run?: JobRunner): Job;
	getJob(id: string): Job | undefined;
	hasRunningJob(): boolean;
	runningJob(): Job | undefined;
	/** Every job the registry still holds, oldest first. */
	listJobs(): Job[];
	/** True when a queued or running job already targets this path. */
	hasActiveJobFor(audioPath: string): boolean;
	/** How many jobs are waiting to start. */
	queuedCount(): number;
	/** Forgets every terminal job. Returns how many it removed. */
	clearFinished(): number;
	/** Streams a snapshot of every job on each change, newest snapshot only. */
	subscribeList(): AsyncIterable<JobSummary[]>;
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

type ListWaiter = (value: IteratorResult<JobSummary[]>) => void;

/**
 * Holds at most one pending snapshot. A slow reader skips the snapshots it
 * missed instead of replaying them: only the newest state of the queue matters.
 */
class SnapshotMailbox {
	private pending: JobSummary[] | null = null;
	private waiter: ListWaiter | null = null;
	private closed = false;

	push(snapshot: JobSummary[]): void {
		if (this.closed) return;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w({ value: snapshot, done: false });
		} else {
			this.pending = snapshot;
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

	next(): Promise<IteratorResult<JobSummary[]>> {
		if (this.pending !== null) {
			const snapshot = this.pending;
			this.pending = null;
			return Promise.resolve({ value: snapshot, done: false });
		}
		if (this.closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise<IteratorResult<JobSummary[]>>((resolve) => {
			this.waiter = resolve;
		});
	}
}

class JobImpl implements Job {
	readonly id: string;
	readonly meta: JobMeta;
	readonly createdAt = Date.now();
	private readonly controller = new AbortController();
	private _status: JobStatus = "queued";
	private _startedAt: number | null = null;
	private _finishedAt: number | null = null;
	private latestProgress: ProgressEvent = { type: "progress", stage: "queued", pct: 0 };
	private terminal: SyncEvent | null = null;
	private readonly subscribers = new Set<Mailbox>();
	private readonly onFinish: (job: JobImpl) => void;
	private readonly onChange: () => void;

	constructor(id: string, meta: JobMeta, onFinish: (job: JobImpl) => void, onChange: () => void) {
		this.id = id;
		this.meta = meta;
		this.onFinish = onFinish;
		this.onChange = onChange;
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	get status(): JobStatus {
		return this._status;
	}

	get startedAt(): number | null {
		return this._startedAt;
	}

	get finishedAt(): number | null {
		return this._finishedAt;
	}

	/** The queue calls this when the job reaches the front. */
	markRunning(): void {
		if (this.terminal || this._status !== "queued") return;
		this._status = "running";
		this._startedAt = Date.now();
		this.onChange();
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
		this.onChange();
	}

	cancel(): boolean {
		if (this.terminal) return false;
		this.controller.abort();
		this.emit(CANCELLED_EVENT);
		this._status = "cancelled";
		this.onChange();
		return true;
	}

	summary(): JobSummary {
		const done = this._status === "done";
		const summary: JobSummary = {
			id: this.id,
			audioPath: this.meta.audioPath,
			lang: this.meta.lang,
			status: this._status,
			// A finished job reads 100% at the last stage, whatever the final
			// progress event happened to say.
			stage: done ? "write" : this.latestProgress.stage,
			pct: done ? 100 : this.latestProgress.pct,
			createdAt: this.createdAt,
			startedAt: this._startedAt,
			finishedAt: this._finishedAt,
		};
		if (!done && this.latestProgress.message !== undefined) {
			summary.message = this.latestProgress.message;
		}
		if (this.terminal?.type === "error") summary.error = this.terminal.message;
		return summary;
	}

	subscribe(): AsyncIterable<SyncEvent> {
		const mailbox = new Mailbox();
		if (this.terminal) {
			mailbox.push(this.terminal);
			mailbox.close();
		} else {
			mailbox.push(this.latestProgress);
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
	/** Ids waiting to start, in the order they arrived. */
	const pending: string[] = [];
	const runners = new Map<string, JobRunner>();
	const listeners = new Set<SnapshotMailbox>();

	const snapshot = (): JobSummary[] => [...jobs.values()].map((j) => j.summary());

	const notify = () => {
		if (listeners.size === 0) return;
		const current = snapshot();
		for (const l of listeners) l.push(current);
	};

	const running = (): JobImpl | undefined => {
		for (const job of jobs.values()) if (job.status === "running") return job;
		return undefined;
	};

	/** Starts the next queued job when the single slot is free. */
	const pump = () => {
		if (running()) return;
		while (pending.length > 0) {
			const id = pending.shift();
			if (id === undefined) return;
			const job = jobs.get(id);
			// Cancelled or expired while it waited.
			if (!job || job.status !== "queued") continue;
			job.markRunning();
			const run = runners.get(id);
			runners.delete(id);
			run?.(job);
			return;
		}
	};

	const forget = (id: string) => {
		jobs.delete(id);
		timers.delete(id);
		runners.delete(id);
		const at = pending.indexOf(id);
		if (at !== -1) pending.splice(at, 1);
	};

	const onFinish = (job: JobImpl) => {
		runners.delete(job.id);
		const at = pending.indexOf(job.id);
		if (at !== -1) pending.splice(at, 1);
		const timer = setTimeout(() => {
			forget(job.id);
			notify();
		}, ttlMs);
		if (typeof timer === "object" && "unref" in timer) timer.unref();
		timers.set(job.id, timer);
		// The slot is free: let the next job in. Deferred so that the caller of
		// `emit` finishes first and a runner that throws cannot unwind into it.
		queueMicrotask(pump);
	};

	return {
		createJob(meta, run) {
			const job = new JobImpl(crypto.randomUUID(), meta, onFinish, notify);
			jobs.set(job.id, job);
			pending.push(job.id);
			if (run) runners.set(job.id, run);
			pump();
			notify();
			return job;
		},
		getJob(id) {
			return jobs.get(id);
		},
		runningJob() {
			return running();
		},
		hasRunningJob() {
			return running() !== undefined;
		},
		listJobs() {
			return [...jobs.values()];
		},
		hasActiveJobFor(audioPath) {
			for (const job of jobs.values()) {
				if (job.meta.audioPath !== audioPath) continue;
				if (job.status === "queued" || job.status === "running") return true;
			}
			return false;
		},
		queuedCount() {
			return pending.length;
		},
		clearFinished() {
			let removed = 0;
			for (const job of [...jobs.values()]) {
				if (job.status === "queued" || job.status === "running") continue;
				const timer = timers.get(job.id);
				if (timer) clearTimeout(timer);
				forget(job.id);
				removed += 1;
			}
			if (removed > 0) notify();
			return removed;
		},
		subscribeList() {
			const mailbox = new SnapshotMailbox();
			mailbox.push(snapshot());
			listeners.add(mailbox);
			const unsubscribe = () => {
				listeners.delete(mailbox);
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
		},
		clear() {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
			jobs.clear();
			runners.clear();
			pending.length = 0;
			for (const l of listeners) l.close();
			listeners.clear();
		},
	};
}

/** The process-wide registry used by the `sync.*` and `jobs.*` procedures. */
export const jobs: JobRegistry = createJobRegistry();
