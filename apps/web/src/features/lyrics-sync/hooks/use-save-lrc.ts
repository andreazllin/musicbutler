import type { AppRouter } from "@musicbutler/server/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";
import { setHasLrc } from "../helpers/set-has-lrc";

type SaveError = TRPCClientErrorLike<AppRouter>;

/** Error copy per tRPC code for `lrc.save` (docs/frontend-structure.md §3.2 rule 2). */
const SAVE_ERRORS: Partial<Record<NonNullable<SaveError["data"]>["code"], string>> = {
	CONFLICT: "The file changed on disk after you opened it.",
	FORBIDDEN: "The server refused this path.",
	NOT_FOUND: "The song is not on disk.",
	BAD_REQUEST: "That path is not an audio file.",
	INTERNAL_SERVER_ERROR: "The server could not write the file.",
};

export function saveErrorMessage(error: SaveError): string {
	const code = error.data?.code;
	return (code && SAVE_ERRORS[code]) || error.message || "The app could not save the lyrics.";
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
		onError: (error) => {
			if (error.data?.code !== "CONFLICT") notify.error(saveErrorMessage(error));
		},
		onSuccess: (result, variables) => {
			if (result.action === "written") notify.success("The app saved the lyrics.");
			else if (result.action === "deleted") notify.success("The app deleted the lyrics file.");
			// The tree carries the hasLrc badge (docs/PLAN.md §5.5). One write
			// settles one flag, so it is patched rather than re-walked.
			setHasLrc(
				queryClient,
				trpc.library.tree.queryKey(),
				variables.audioPath,
				result.action === "written",
			);
		},
		onSettled: (_result, _error, variables) => {
			void queryClient.invalidateQueries({
				queryKey: trpc.lrc.get.queryKey({ audioPath: variables.audioPath }),
			});
		},
	});
}
