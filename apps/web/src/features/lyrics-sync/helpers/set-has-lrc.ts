import type { LibraryTree } from "@musicbutler/shared";
import type { QueryClient } from "@tanstack/react-query";
import { withHasLrc } from "./tree";

/**
 * Flips one song's "has lyrics" badge in the cached library tree.
 *
 * A save changes exactly one flag, so the tree is patched in place. Asking for
 * `library.tree` again would walk the entire library to learn the same thing.
 */
export function setHasLrc(
	queryClient: QueryClient,
	queryKey: readonly unknown[],
	audioPath: string,
	hasLrc: boolean,
): void {
	queryClient.setQueryData<LibraryTree>(queryKey, (tree) =>
		tree ? withHasLrc(tree, audioPath, hasLrc) : tree,
	);
}
