import { describe, expect, test } from "bun:test";
import { divAround, slugify, songUrl } from "../src/lyrics/azlyrics.ts";
import { stripSectionHeaders } from "../src/lyrics/genius.ts";
import { cleanTitle, decodeEntities, extractElements, htmlToLines } from "../src/lyrics/html.ts";

describe("lyrics/html decodeEntities", () => {
	test("resolves the named entities that show up in song text", () => {
		expect(decodeEntities("rock &amp; roll")).toBe("rock & roll");
		expect(decodeEntities("it&rsquo;s")).toBe("it’s");
		expect(decodeEntities("a&nbsp;b")).toBe("a b");
	});

	test("resolves decimal and hexadecimal references", () => {
		expect(decodeEntities("caf&#233;")).toBe("café");
		expect(decodeEntities("caf&#xe9;")).toBe("café");
	});

	test("leaves anything it does not know exactly as it came", () => {
		expect(decodeEntities("&notareal; &#x110000;")).toBe("&notareal; &#x110000;");
	});
});

describe("lyrics/html htmlToLines", () => {
	test("turns breaks into lines and drops the inline tags around them", () => {
		const html = 'alpha bravo<br/>charlie <i>delta</i><br>echo <a href="#x">foxtrot</a>';
		expect(htmlToLines(html)).toBe("alpha bravo\ncharlie delta\necho foxtrot");
	});

	test("drops comments, script and style, which carry no words", () => {
		const html = "<!-- a note --><script>var x = 1;</script><style>p{}</style>golf hotel";
		expect(htmlToLines(html)).toBe("golf hotel");
	});

	test("collapses a run of blank lines and trims the ends", () => {
		expect(htmlToLines("<br><br>india<br><br><br><br>juliett<br><br>")).toBe("india\n\njuliett");
	});
});

describe("lyrics/html extractElements", () => {
	test("reads the inner html of every matching element", () => {
		const html =
			'<div data-lyrics-container="true">one</div><div class="ad">skip</div>' +
			'<div data-lyrics-container="true">two</div>';
		expect(extractElements(html, "div", "data-lyrics-container")).toEqual(["one", "two"]);
	});

	test("counts nesting, so a container holding a div is not cut at the first close", () => {
		const html = '<div data-lyrics-container="true">before<div class="x">inner</div>after</div>';
		expect(extractElements(html, "div", "data-lyrics-container")).toEqual([
			'before<div class="x">inner</div>after',
		]);
	});

	test("an unclosed container yields nothing rather than the rest of the page", () => {
		expect(extractElements('<div data-lyrics-container="true">oops', "div", "x-none")).toEqual([]);
		expect(extractElements('<div data-lyrics-container="true">oops', "div", "data-lyrics")).toEqual(
			[],
		);
	});
});

describe("lyrics/genius stripSectionHeaders", () => {
	test("drops the section labels, which the LRC parser would read as tags", () => {
		const text = "[Verse 1]\nalpha bravo\ncharlie\n\n[Chorus]\ndelta echo";
		expect(stripSectionHeaders(text)).toBe("alpha bravo\ncharlie\n\ndelta echo");
	});

	test("keeps a line that only holds brackets inside other words", () => {
		expect(stripSectionHeaders("alpha [bravo] charlie")).toBe("alpha [bravo] charlie");
	});
});

describe("lyrics/html cleanTitle", () => {
	test("removes the site suffix and the trailing word Lyrics", () => {
		expect(cleanTitle("Some Song Lyrics")).toBe("Some Song");
		expect(cleanTitle("Some Song | Genius Lyrics")).toBe("Some Song");
		expect(cleanTitle("  spaced   out  ")).toBe("spaced out");
	});
});

describe("lyrics/azlyrics addresses", () => {
	test("a slug keeps only letters and digits, lower case", () => {
		expect(slugify("Some Artist")).toBe("someartist");
		expect(slugify("A.C.  Band!")).toBe("acband");
		expect(slugify("Beyoncé")).toBe("beyonce");
		expect(slugify("  ")).toBe("");
	});

	test("a leading The is dropped from the artist, as the site spells it", () => {
		expect(songUrl("The Example Band", "Some Song")).toBe(
			"https://www.azlyrics.com/lyrics/exampleband/somesong.html",
		);
	});

	test("an artist or a title that slugs to nothing has no address", () => {
		expect(songUrl("!!!", "Some Song")).toBeNull();
		expect(songUrl("Some Artist", "???")).toBeNull();
	});
});

describe("lyrics/azlyrics divAround", () => {
	const marker = "Usage of azlyrics.com content";

	test("returns the div that holds the marker, not the one after it", () => {
		const html = `<body><div class="x"><div><!-- ${marker} -->alpha bravo<br>charlie</div></div><div>unrelated</div></body>`;
		const at = html.indexOf(marker);
		expect(htmlToLines(divAround(html, at) as string)).toBe("alpha bravo\ncharlie");
	});

	test("counts nesting inside the container", () => {
		const html = `<div><!-- ${marker} -->alpha<div><i>bravo</i></div>charlie</div>`;
		const at = html.indexOf(marker);
		expect(htmlToLines(divAround(html, at) as string)).toBe("alpha\nbravo\ncharlie");
	});

	test("a container that never closes yields nothing", () => {
		const html = `<div><!-- ${marker} -->alpha`;
		expect(divAround(html, html.indexOf(marker))).toBeNull();
	});
});
