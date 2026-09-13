import { describe, expect, test } from "bun:test";
import { decodeBase64Url, encodeBase64Url } from "../src/lib/base64url";

describe("base64url", () => {
	const paths = [
		"Artist One/Album A/02 Second Song.flac",
		"",
		"a",
		"ab",
		"abc",
		"Sigur Rós/Ágætis byrjun/Svefn-g-englar.mp3",
		"日本語/アルバム/曲.m4a",
		"folder with spaces/track #1 (live) & more [2024].opus",
		"emoji 🎵/song 🎶.ogg",
	];

	test.each(paths)("round-trips %j", (path) => {
		expect(decodeBase64Url(encodeBase64Url(path))).toBe(path);
	});

	test("emits no character that a URL would percent-encode", () => {
		for (const path of paths) {
			const encoded = encodeBase64Url(path);
			expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
			expect(encodeURIComponent(encoded)).toBe(encoded);
		}
	});

	test("hides the folder separators", () => {
		expect(encodeBase64Url("Artist One/Album A/02 Second Song.flac")).not.toContain("/");
	});

	test("returns null for input that is not base64url", () => {
		// A leftover plain path from an older link: "/" and "." are outside the alphabet.
		expect(decodeBase64Url("Artist One/Album A/02 Second Song.flac")).toBeNull();
		expect(decodeBase64Url("not base64!")).toBeNull();
	});

	test("returns null when the bytes are not valid UTF-8", () => {
		// 0xff is never a valid UTF-8 lead byte.
		expect(decodeBase64Url(encodeBase64UrlBytes([0xff, 0xfe]))).toBeNull();
	});
});

/** base64url of raw bytes, to build input that `encodeBase64Url` cannot produce. */
function encodeBase64UrlBytes(bytes: number[]): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
