import { describe, expect, test } from "bun:test";
import { guessFromPath, titleFromFileName } from "../src/features/lyrics-import/helpers/guess";

describe("lyrics-import/guess titleFromFileName", () => {
	test("drops the extension", () => {
		expect(titleFromFileName("Some Song.mp3")).toBe("Some Song");
		expect(titleFromFileName("Some Song.flac")).toBe("Some Song");
	});

	test("drops a leading track number in the shapes libraries use", () => {
		expect(titleFromFileName("01 Some Song.mp3")).toBe("Some Song");
		expect(titleFromFileName("01. Some Song.mp3")).toBe("Some Song");
		expect(titleFromFileName("01 - Some Song.mp3")).toBe("Some Song");
		expect(titleFromFileName("1-05 Some Song.mp3")).toBe("Some Song");
	});

	test("keeps digits that are part of the name", () => {
		expect(titleFromFileName("Song 42.mp3")).toBe("Song 42");
	});

	test("a name that is only a number keeps it rather than becoming empty", () => {
		expect(titleFromFileName("01.mp3")).toBe("01");
	});

	test("underscores read as spaces", () => {
		expect(titleFromFileName("02_some_song.mp3")).toBe("some song");
	});
});

describe("lyrics-import/guess guessFromPath", () => {
	test("reads artist and album from the two folders above the file", () => {
		expect(guessFromPath("Artist One/Album A/01 First Song.mp3")).toEqual({
			artist: "Artist One",
			album: "Album A",
			title: "First Song",
		});
	});

	test("takes the two nearest folders whatever the depth above them", () => {
		expect(guessFromPath("Music/FLAC/2019/Artist One/Album A/03 Third Song.flac")).toEqual({
			artist: "Artist One",
			album: "Album A",
			title: "Third Song",
		});
	});

	test("one folder above the file is the artist, with no album", () => {
		expect(guessFromPath("Artist Two/Single.m4a")).toEqual({
			artist: "Artist Two",
			album: "",
			title: "Single",
		});
	});

	test("a file at the root of the library has neither", () => {
		expect(guessFromPath("Loose Track.mp3")).toEqual({
			artist: "",
			album: "",
			title: "Loose Track",
		});
	});
});
