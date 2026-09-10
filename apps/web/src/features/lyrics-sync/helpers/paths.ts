/** Parent directory of a library-relative path; "" for a top-level entry. */
export function parentDirOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** File name of a library-relative path. */
export function baseNameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Every ancestor directory of a path, root ("") first, excluding the path itself. */
export function ancestorsOf(path: string): string[] {
	const parts = path.split("/");
	parts.pop();
	const out = [""];
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		out.push(acc);
	}
	return out;
}
