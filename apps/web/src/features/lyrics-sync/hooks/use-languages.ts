import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

/** Which ASR models this build holds (docs/PLAN.md §6.2 `sync.languages`). */
export function useLanguages() {
	const trpc = useTRPC();
	return useQuery({ ...trpc.sync.languages.queryOptions(), staleTime: Number.POSITIVE_INFINITY });
}
