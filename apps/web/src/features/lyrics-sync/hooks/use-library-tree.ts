import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

/**
 * The whole library in one query (`library.tree`). The tree holds every folder
 * and song, so the filter can reach a name at any depth without the user having
 * to open the folders first.
 */
export function useLibraryTree() {
	const trpc = useTRPC();
	return useQuery({
		...trpc.library.tree.queryOptions(),
		// Walking the library is the expensive part, and a save patches the one
		// node it touched rather than asking for the whole thing again.
		staleTime: Number.POSITIVE_INFINITY,
	});
}
