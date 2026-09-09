import { describe, expect, test } from "bun:test";
import { extensionOf, isAudioFile, lrcPathFor } from "../src/index.ts";

describe("isAudioFile", () => {
	test("matches supported extensions regardless of case", () => {
		expect(isAudioFile("01 Track.flac")).toBe(true);
		expect(isAudioFile("01 Track.FLAC")).toBe(true);
		expect(isAudioFile("song.Mp3")).toBe(true);
		expect(isAudioFile("song.dsf")).toBe(true);
	});
	test("rejects lyrics, images, dotfiles and extension-less names", () => {
		expect(isAudioFile("01 Track.lrc")).toBe(false);
		expect(isAudioFile("cover.jpg")).toBe(false);
		expect(isAudioFile(".DS_Store")).toBe(false);
		expect(isAudioFile(".mp3")).toBe(false);
		expect(isAudioFile("README")).toBe(false);
	});
});

describe("extensionOf", () => {
	test("returns the lower-cased extension with the dot", () => {
		expect(extensionOf("A.B.FLAC")).toBe(".flac");
		expect(extensionOf("noext")).toBe("");
		expect(extensionOf(".hidden")).toBe("");
	});
});

describe("lrcPathFor", () => {
	test("replaces the extension in the same directory", () => {
		expect(lrcPathFor("Artist/Album/01 Track.flac")).toBe("Artist/Album/01 Track.lrc");
		expect(lrcPathFor("song.MP3")).toBe("song.lrc");
		expect(lrcPathFor("Artist/a.b.c.ogg")).toBe("Artist/a.b.c.lrc");
	});
});
