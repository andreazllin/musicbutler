import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

/** The saved `.lrc` for a song (docs/PLAN.md §6.2 `lrc.get`). Disabled while no song is selected. */
export function useLrcFile(audioPath: string | null) {
	const trpc = useTRPC();
	return useQuery({
		...trpc.lrc.get.queryOptions({ audioPath: audioPath ?? "" }),
		enabled: audioPath !== null,
	});
}
