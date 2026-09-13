/**
 * base64url (RFC 4648 §5) for values that travel in the query string. The
 * standard alphabet's `+` and `/` and the `=` padding are all percent-encoded
 * by a URL, which is noisy and, for a library path, would put the folder
 * separators back on screen.
 *
 * `btoa` and `atob` work on Latin-1, so the text goes through TextEncoder
 * first: a library path may hold any UTF-8 character.
 */
export function encodeBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The inverse. Returns null for anything that is not valid base64url UTF-8. */
export function decodeBase64Url(value: string): string | null {
	try {
		const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
		const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		// `fatal` so malformed bytes throw instead of yielding replacement characters.
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
