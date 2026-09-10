/**
 * tRPC builders and error mapping (docs/PLAN.md §6).
 *
 * Every procedure runs through `mapErrors`, which turns filesystem errors into
 * tRPC codes with generic messages. No message ever carries a user path.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { FORBIDDEN_MESSAGE } from "./fs/paths.ts";
import { log } from "./log.ts";

/** No auth in v1: the context is empty. */
export type Context = Record<string, never>;

const t = initTRPC.context<Context>().create({
	errorFormatter({ shape, error }) {
		if (error.code === "FORBIDDEN") {
			return { ...shape, message: FORBIDDEN_MESSAGE };
		}
		return shape;
	},
});

function causeCode(err: unknown): string | undefined {
	if (typeof err !== "object" || err === null) return undefined;
	const code = (err as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

/** Maps a thrown value to the TRPCError the client should see (§6.2, §5.3). */
export function mapError(err: unknown): TRPCError {
	if (err instanceof TRPCError) {
		if (err.code === "INTERNAL_SERVER_ERROR" && err.cause) return mapError(err.cause);
		if (err.code === "FORBIDDEN") {
			return new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_MESSAGE, cause: err.cause });
		}
		return err;
	}
	switch (causeCode(err)) {
		case "ENOENT":
		case "ENOTDIR":
			return new TRPCError({ code: "NOT_FOUND", message: "Not found", cause: err });
		case "EACCES":
		case "EPERM":
			return new TRPCError({ code: "FORBIDDEN", message: "Permission denied", cause: err });
		default:
			log.error("Unhandled error in procedure", err);
			return new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Internal server error",
				cause: err,
			});
	}
}

const mapErrors = t.middleware(async ({ next }) => {
	const result = await next();
	if (result.ok) return result;
	const mapped = mapError(result.error);
	if (mapped === result.error) return result;
	throw mapped;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(mapErrors);
export const createCallerFactory = t.createCallerFactory;
