import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseHTML } from "linkedom";
import { cleanMarkdown, domToMarkdown } from "../extensions/markdown.ts";

const convert = (html: string, links = false) =>
	domToMarkdown(parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body, { links, baseUrl: "https://example.com/guide/page" });

describe("domToMarkdown", () => {
	test("keeps code blocks verbatim, with their language", () => {
		const html = `<pre data-lang="yaml"><code>services:\n  db:\n    image: postgres  # comment . ,\n</code></pre>`;
		assert.equal(convert(html), "```yaml\nservices:\n  db:\n    image: postgres  # comment . ,\n```");
	});

	test("escapes text that would read as a heading, not headings", () => {
		assert.equal(convert("<h2># 1</h2><p># Comments: 5<br>#hashtag<br>## two</p><ul><li># x</li></ul>"), "## # 1\n\n\\# Comments: 5\n#hashtag\n\\## two\n\n- \\# x");
	});

	test("renders inline code and emphasis without moving surrounding spaces", () => {
		assert.equal(convert("<p>Call <code>fetch()</code> and <strong> await </strong>it, <em>then</em> parse.</p>"), "Call `fetch()` and **await** it, *then* parse.");
	});

	test("drops link targets unless asked, resolving relative ones", () => {
		const html = `<p>See <a href="../docs">the docs</a>.</p>`;
		assert.equal(convert(html), "See the docs.");
		assert.equal(convert(html, true), "See [the docs](https://example.com/docs).");
	});

	test("drops permalinks and citation markers", () => {
		const html = `<h2>Usage<a href="#usage">¶</a></h2><p>A fact<sup><a href="#cite-1">[1]</a></sup>, <a href="#usage">see usage</a>.</p>`;
		assert.equal(convert(html), "## Usage\n\nA fact, see usage.");
	});

	test("nests lists and honours the start of ordered lists", () => {
		assert.equal(convert("<ul><li>One<ul><li>Two</li></ul></li><li>Three</li></ul>"), "- One\n  - Two\n- Three");
		assert.equal(convert(`<ol start="3"><li>c</li><li>d</li></ol>`), "3. c\n4. d");
	});

	test("renders tables without their empty columns", () => {
		const html = "<table><tr><th>Name</th><th></th><th>Value</th></tr><tr><td>a | b</td><td></td><td>1</td></tr><tr><td></td><td></td><td></td></tr></table>";
		assert.equal(convert(html), "| Name | Value |\n| --- | --- |\n| a \\| b | 1 |");
	});

	test("renders layout tables (tables of tables) as blocks", () => {
		const html = "<table><tr><td><table><tr><td>1.</td><td>Story</td></tr></table></td></tr><tr><td>More</td></tr></table>";
		assert.equal(convert(html), "| 1. | Story |\n| --- | --- |\n\nMore");
	});

	test("skips scripts, navigation and form controls", () => {
		assert.equal(convert("<nav>Menu</nav><p>Text<script>x()</script><button>Copy</button></p>"), "Text");
	});
});

describe("cleanMarkdown", () => {
	test("removes images, comments and link targets but not code", () => {
		const md = "![logo](a.png) Read [the guide](https://x.y/g \"Guide\") and [this][1].<!-- note -->\n\n[1]: https://x.y/1\n\n```md\n[keep](this)\n```";
		assert.equal(cleanMarkdown(md), "Read the guide and this.\n\n```md\n[keep](this)\n```");
	});

	test("leaves ~~~ and indented fences untouched", () => {
		const md = "- Step [one](https://x.y):\n\n   ```sh\n   # not a heading [or](a-link)\n   ```\n\n~~~\n# comment\n~~~";
		assert.equal(cleanMarkdown(md, { shiftHeadings: 2 }), "- Step one:\n\n   ```sh\n   # not a heading [or](a-link)\n   ```\n\n~~~\n# comment\n~~~");
	});

	test("keeps links when asked", () => {
		assert.equal(cleanMarkdown("[a](https://x.y)", { links: true }), "[a](https://x.y)");
	});

	test("demotes ATX and setext headings", () => {
		assert.equal(cleanMarkdown("# One\n\nTwo\n---\n\nThree\n===", { shiftHeadings: 2 }), "### One\n\n#### Two\n\n### Three");
	});
});
