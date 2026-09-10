/**
 * Model availability for `/healthz` (docs/PLAN.md §6.3, §8.3): true when at
 * least one language can run without any download. Delegates to the engine.
 */
export { modelsReady } from "./sync/engine.ts";
