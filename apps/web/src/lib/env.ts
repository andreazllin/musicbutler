import { z } from "zod";

/**
 * Environment parsed once at module load (docs/frontend-structure.md §3.4).
 * A missing or malformed variable fails here, at boot, instead of three screens deep.
 */
const schema = z.object({
	/** Base URL of the API. Empty means same origin (the server serves the SPA in production). */
	VITE_API_BASE: z.string().default(""),
});

export const env = schema.parse({
	VITE_API_BASE: import.meta.env.VITE_API_BASE,
});
