import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

/** One directory listing, fetched lazily (docs/PLAN.md §6.2 `library.list`). */
export function useLibraryDir(path: string, options: { enabled?: boolean } = {}) {
	const trpc = useTRPC();
	return useQuery({
		...trpc.library.list.queryOptions({ path }),
		enabled: options.enabled ?? true,
	});
}
