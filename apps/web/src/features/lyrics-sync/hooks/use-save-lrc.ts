import type { AppRouter } from "@musicbutler/server/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";
import { parentDirOf } from "../helpers/paths";

type SaveError = TRPCClientErrorLike<AppRouter>;

/** Error copy per tRPC code for `lrc.save` (docs/frontend-structure.md §3.2 rule 2). */
const SAVE_ERRORS: Partial<Record<NonNullable<SaveError["data"]>["code"], string>> = {
	CONFLICT: "The file changed on disk since you loaded it.",
	FORBIDDEN: "The server refused this path.",
	NOT_FOUND: "The song no longer exists on disk.",
	BAD_REQUEST: "That path is not an audio file.",
	INTERNAL_SERVER_ERROR: "The server could not write the file.",
};

export function saveErrorMessage(error: SaveError): string {
	const code = error.data?.code;
	return (code && SAVE_ERRORS[code]) || error.message || "Saving failed.";
}

/**
 * `lrc.save` (docs/PLAN.md §5.2, §6.2). Cache work happens in `onSettled`, so
 * the cache is right whether or not the write succeeded. A CONFLICT is left to
 * the caller, which opens the reload-or-overwrite dialog instead of a toast.
 */
export function useSaveLrc() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return useMutation({
		...trpc.lrc.save.mutationOptions(),
		onSuccess: (result) => {
			if (result.action === "written") notify.success("Lyrics saved");
			else if (result.action === "deleted") notify.success("Lyrics file deleted");
		},
		onError: (error) => {
			if (error.data?.code !== "CONFLICT") notify.error(saveErrorMessage(error));
		},
		onSettled: (_result, _error, variables) => {
			void queryClient.invalidateQueries({
				queryKey: trpc.lrc.get.queryKey({ audioPath: variables.audioPath }),
			});
			// The parent listing carries the hasLrc badge (docs/PLAN.md §5.5).
			void queryClient.invalidateQueries({
				queryKey: trpc.library.list.queryKey({ path: parentDirOf(variables.audioPath) }),
			});
		},
	});
}
