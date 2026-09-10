import axios, { AxiosError } from "axios";
import { env } from "./env.ts";

/**
 * The axios instance serves the routes that are not RPC, today `GET /media/stream`
 * (docs/PLAN.md §4.2). Cross-cutting behavior lives in the interceptors, not at call sites.
 */
export const http = axios.create({
	baseURL: env.VITE_API_BASE || undefined,
	withCredentials: true,
});

/** A normalized error every caller can show to the user. */
export class HttpError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

http.interceptors.response.use(
	(response) => response,
	(error: unknown) => {
		if (error instanceof AxiosError) {
			const status = error.response?.status ?? null;
			const message =
				status === null
					? "The server did not respond."
					: `The server answered ${status} ${error.response?.statusText ?? ""}`.trim();
			return Promise.reject(new HttpError(message, status));
		}
		return Promise.reject(error);
	},
);

/** URL of the audio stream for a library-relative path (docs/PLAN.md §6.3). */
export function mediaStreamUrl(libraryPath: string): string {
	return `${env.VITE_API_BASE}/media/stream?path=${encodeURIComponent(libraryPath)}`;
}
