import { describe, expect, test } from "bun:test";
import type { JobSummary, SyncEvent } from "@musicbutler/shared";
import { createJobRegistry, type JobMeta } from "../src/jobs/registry.ts";

const meta: JobMeta = { audioPath: "Artist Two/Single.m4a", lang: "en-US" };

async function collect(it: AsyncIterable<SyncEvent>, max = 50): Promise<SyncEvent[]> {
	const out: SyncEvent[] = [];
	for await (const ev of it) {
		out.push(ev);
		if (out.length >= max) break;
	}
	return out;
}

describe("jobs/registry", () => {
	test("createJob / getJob / one running job at a time", () => {
		const reg = createJobRegistry();
		expect(reg.hasRunningJob()).toBe(false);
		const job = reg.createJob(meta);
		expect(reg.getJob(job.id)).toBe(job);
		expect(job.status).toBe("running");
		expect(reg.hasRunningJob()).toBe(true);
		expect(reg.runningJob()?.id).toBe(job.id);
		job.emit({ type: "done", content: "[00:01.00]x\n", mtimeMs: 1 });
		expect(job.status).toBe("done");
		expect(reg.hasRunningJob()).toBe(false);
		reg.clear();
	});

	test("a new subscriber first receives the latest progress event, then live events", async () => {
		const reg = createJobRegistry();
		const job = reg.createJob(meta);
		job.emit({ type: "progress", stage: "decode", pct: 10 });
		job.emit({ type: "progress", stage: "separate", pct: 40, message: "demucs" });

		const events = collect(job.subscribe());
		// Let the subscriber attach before the live events fire.
		await Promise.resolve();
		job.emit({ type: "progress", stage: "align", pct: 80 });
		job.emit({ type: "done", content: "c", mtimeMs: 2 });
		// Dropped: the job is already terminal.
		job.emit({ type: "progress", stage: "write", pct: 99 });

		expect(await events).toEqual([
			{ type: "progress", stage: "separate", pct: 40, message: "demucs" },
			{ type: "progress", stage: "align", pct: 80 },
			{ type: "done", content: "c", mtimeMs: 2 },
		]);
		reg.clear();
	});

	test("the initial replay is the queued event when nothing has been emitted yet", async () => {
		const reg = createJobRegistry();
		const job = reg.createJob(meta);
		const events = collect(job.subscribe());
		job.emit({ type: "error", code: "DECODE_FAILED", message: "ffmpeg exited 1" });
		expect(await events).toEqual([
			{ type: "progress", stage: "queued", pct: 0 },
			{ type: "error", code: "DECODE_FAILED", message: "ffmpeg exited 1" },
		]);
		expect(job.status).toBe("error");
		reg.clear();
	});

	test("subscribing after completion yields only the terminal event", async () => {
		const reg = createJobRegistry();
		const job = reg.createJob(meta);
		job.emit({ type: "done", content: "c", mtimeMs: 3 });
		expect(await collect(job.subscribe())).toEqual([{ type: "done", content: "c", mtimeMs: 3 }]);
		reg.clear();
	});

	test("cancel aborts the signal, closes subscribers with CANCELLED, and drops later emits", async () => {
		const reg = createJobRegistry();
		const job = reg.createJob(meta);
		let aborted = false;
		job.signal.addEventListener("abort", () => {
			aborted = true;
		});
		const events = collect(job.subscribe());
		await Promise.resolve();
		expect(job.cancel()).toBe(true);
		expect(aborted).toBe(true);
		expect(job.signal.aborted).toBe(true);
		expect(job.status).toBe("cancelled");
		expect(reg.hasRunningJob()).toBe(false);
		// The engine notices the abort late and still tries to report.
		job.emit({ type: "error", code: "ABORTED", message: "late" });
		expect(await events).toEqual([
			{ type: "progress", stage: "queued", pct: 0 },
			{ type: "error", code: "CANCELLED", message: "Cancelled by the user" },
		]);
		expect(job.cancel()).toBe(false);
		reg.clear();
	});

	test("breaking out of the subscription unsubscribes", async () => {
		const reg = createJobRegistry();
		const job = reg.createJob(meta);
		const it = job.subscribe()[Symbol.asyncIterator]();
		expect((await it.next()).value).toEqual({ type: "progress", stage: "queued", pct: 0 });
		await it.return?.();
		// A later emit must not throw or hang.
		job.emit({ type: "progress", stage: "decode", pct: 5 });
		expect((await it.next()).done).toBe(true);
		reg.clear();
	});

	test("finished jobs are forgotten after the TTL", async () => {
		const reg = createJobRegistry({ ttlMs: 20 });
		const job = reg.createJob(meta);
		job.emit({ type: "done", content: "c", mtimeMs: 4 });
		expect(reg.getJob(job.id)).toBeDefined();
		await new Promise((r) => setTimeout(r, 60));
		expect(reg.getJob(job.id)).toBeUndefined();
		reg.clear();
	});
});

describe("jobs/registry queue", () => {
	const metaFor = (audioPath: string): JobMeta => ({ audioPath, lang: "en-US" });

	test("one job runs and the rest wait in the order they arrived", () => {
		const reg = createJobRegistry();
		const started: string[] = [];
		const a = reg.createJob(metaFor("a.mp3"), (j) => started.push(j.meta.audioPath));
		const b = reg.createJob(metaFor("b.mp3"), (j) => started.push(j.meta.audioPath));
		const c = reg.createJob(metaFor("c.mp3"), (j) => started.push(j.meta.audioPath));

		expect(a.status).toBe("running");
		expect(b.status).toBe("queued");
		expect(c.status).toBe("queued");
		expect(started).toEqual(["a.mp3"]);
		expect(reg.queuedCount()).toBe(2);
		reg.clear();
	});

	test("finishing the running job starts the next one", async () => {
		const reg = createJobRegistry();
		const started: string[] = [];
		const a = reg.createJob(metaFor("a.mp3"), (j) => started.push(j.meta.audioPath));
		const b = reg.createJob(metaFor("b.mp3"), (j) => started.push(j.meta.audioPath));

		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		// The queue advances on a microtask, so the emit call stack unwinds first.
		await Promise.resolve();
		expect(started).toEqual(["a.mp3", "b.mp3"]);
		expect(b.status).toBe("running");
		expect(reg.queuedCount()).toBe(0);
		reg.clear();
	});

	test("a failing job still lets the queue move on", async () => {
		const reg = createJobRegistry();
		const started: string[] = [];
		const a = reg.createJob(metaFor("a.mp3"), (j) => started.push(j.meta.audioPath));
		const b = reg.createJob(metaFor("b.mp3"), (j) => started.push(j.meta.audioPath));

		a.emit({ type: "error", code: "ALIGN_FAILED", message: "no" });
		await Promise.resolve();
		expect(b.status).toBe("running");
		expect(started).toEqual(["a.mp3", "b.mp3"]);
		reg.clear();
	});

	test("cancelling a queued job never starts it and keeps the order of the rest", async () => {
		const reg = createJobRegistry();
		const started: string[] = [];
		const a = reg.createJob(metaFor("a.mp3"), (j) => started.push(j.meta.audioPath));
		const b = reg.createJob(metaFor("b.mp3"), (j) => started.push(j.meta.audioPath));
		const c = reg.createJob(metaFor("c.mp3"), (j) => started.push(j.meta.audioPath));

		expect(b.cancel()).toBe(true);
		expect(b.status).toBe("cancelled");
		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		await Promise.resolve();

		expect(started).toEqual(["a.mp3", "c.mp3"]);
		expect(c.status).toBe("running");
		reg.clear();
	});

	test("hasActiveJobFor covers the queued job as well as the running one", () => {
		const reg = createJobRegistry();
		const a = reg.createJob(metaFor("a.mp3"));
		reg.createJob(metaFor("b.mp3"));

		expect(reg.hasActiveJobFor("a.mp3")).toBe(true);
		expect(reg.hasActiveJobFor("b.mp3")).toBe(true);
		expect(reg.hasActiveJobFor("c.mp3")).toBe(false);

		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		expect(reg.hasActiveJobFor("a.mp3")).toBe(false);
		reg.clear();
	});

	test("clearFinished removes terminal jobs and keeps the live ones", async () => {
		const reg = createJobRegistry();
		const a = reg.createJob(metaFor("a.mp3"));
		const b = reg.createJob(metaFor("b.mp3"));
		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		await Promise.resolve();

		expect(reg.clearFinished()).toBe(1);
		expect(reg.getJob(a.id)).toBeUndefined();
		expect(reg.getJob(b.id)).toBeDefined();
		expect(reg.listJobs().map((j) => j.id)).toEqual([b.id]);
		reg.clear();
	});

	test("a summary reports the queue state, and a done job reads 100%", async () => {
		const reg = createJobRegistry();
		const a = reg.createJob(metaFor("a.mp3"));
		const b = reg.createJob(metaFor("b.mp3"));

		expect(a.summary()).toMatchObject({ status: "running", stage: "queued", pct: 0 });
		expect(b.summary()).toMatchObject({ status: "queued", startedAt: null });
		expect(a.summary().startedAt).not.toBeNull();

		a.emit({ type: "progress", stage: "align", pct: 42, message: "3/7" });
		expect(a.summary()).toMatchObject({ stage: "align", pct: 42, message: "3/7" });

		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		await Promise.resolve();
		expect(a.summary()).toMatchObject({ status: "done", stage: "write", pct: 100 });
		expect(a.summary().finishedAt).not.toBeNull();
		reg.clear();
	});

	test("an error summary carries the message, so the screen can show why", () => {
		const reg = createJobRegistry();
		const a = reg.createJob(metaFor("a.mp3"));
		a.emit({ type: "error", code: "ALIGN_FAILED", message: "the lyrics do not match" });
		expect(a.summary()).toMatchObject({ status: "error", error: "the lyrics do not match" });
		reg.clear();
	});

	test("subscribeList replays the current list, then a snapshot per change", async () => {
		const reg = createJobRegistry();
		const it = reg.subscribeList()[Symbol.asyncIterator]();
		expect((await it.next()).value).toEqual([]);

		const a = reg.createJob(metaFor("a.mp3"));
		const first = (await it.next()).value as JobSummary[];
		expect(first.map((j) => j.audioPath)).toEqual(["a.mp3"]);

		a.emit({ type: "done", content: "c", mtimeMs: 1 });
		const second = (await it.next()).value as JobSummary[];
		expect(second[0]?.status).toBe("done");

		await it.return?.();
		reg.clear();
	});

	test("a slow listener sees the newest snapshot, not a backlog", async () => {
		const reg = createJobRegistry();
		const it = reg.subscribeList()[Symbol.asyncIterator]();
		await it.next(); // the initial empty list

		const a = reg.createJob(metaFor("a.mp3"));
		// Three changes land before the listener reads even one of them.
		a.emit({ type: "progress", stage: "decode", pct: 1 });
		a.emit({ type: "progress", stage: "align", pct: 90 });

		const snapshot = (await it.next()).value as JobSummary[];
		expect(snapshot[0]).toMatchObject({ stage: "align", pct: 90 });
		await it.return?.();
		reg.clear();
	});
});
