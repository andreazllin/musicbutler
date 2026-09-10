import { describe, expect, test } from "bun:test";
import type { SyncEvent } from "@musicbutler/shared";
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
