import { QueryClient } from "@tanstack/react-query";

/** The one query client (docs/frontend-structure.md §1.1). Configure it here only. */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Directory listings and .lrc contents change only when this app writes them,
			// so a short stale time avoids refetch storms while keeping edits visible.
			staleTime: 30_000,
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});
