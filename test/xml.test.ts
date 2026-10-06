import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { xmlRoot, xmlToPage } from "../extensions/xml.ts";

const page = (xml: string, href = "https://x.y/feed", links = false) => xmlToPage(xml, new URL(href), { links, signal: new AbortController().signal });

describe("xmlRoot", () => {
	test("finds the root element past the prologue", () => {
		assert.equal(xmlRoot('\uFEFF<?xml version="1.0"?>\n<?xml-stylesheet href="s.xsl"?>\n<!-- c -->\n<rss version="2.0">'), "rss");
		assert.equal(xmlRoot('<feed xmlns="http://www.w3.org/2005/Atom">'), "feed");
		assert.equal(xmlRoot("<urlset>"), "urlset");
	});

	test("ignores other XML and HTML", () => {
		assert.equal(xmlRoot('<?xml version="1.0"?><project><feed/></project>'), undefined);
		assert.equal(xmlRoot("<!doctype html><html><body>rss</body></html>"), undefined);
		assert.equal(xmlRoot("plain text"), undefined);
	});
});

describe("feeds", () => {
	test("RSS: title, site, entries with date, author, link and content", () => {
		const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Blog &amp; Co</title><link>https://x.y</link>
<item><title><![CDATA[First]]></title><link>https://x.y/1</link><pubDate>Mon, 06 Oct 2025 10:00:00 GMT</pubDate><dc:creator>Ann</dc:creator>
<description>Short</description><content:encoded><![CDATA[<h2>Intro</h2><p>Full <a href="/a">text</a></p>]]></content:encoded></item>
<item><title>Second</title><guid>https://x.y/2</guid><description>&lt;p&gt;Escaped &amp;amp; decoded&lt;/p&gt;</description></item>
<item><title>Third</title><guid isPermaLink="false">id-3</guid><description>Plain  text</description></item>
</channel></rss>`;
		const result = page(rss);
		assert.equal(result?.title, "Blog & Co");
		assert.deepEqual(result?.meta, ["feed with 3 entries", "site: https://x.y"]);
		assert.equal(
			result?.text,
			["## First", "2025-10-06 · Ann · https://x.y/1", "### Intro\n\nFull text", "## Second", "https://x.y/2", "Escaped & decoded", "## Third", "Plain text"].join("\n\n"),
		);
	});

	test("Atom: alternate links, html and xhtml content, summary as fallback", () => {
		const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><link rel="self" href="https://x.y/feed"/><link rel="alternate" href="https://x.y"/>
<entry><title>v2</title><link href="https://x.y/v2"/><published>2025-10-06T10:00:00Z</published><author><name>Bob</name></author>
<content type="html">&lt;p&gt;Notes&lt;/p&gt;</content></entry>
<entry><title>v1</title><link rel="alternate" href="https://x.y/v1"/><updated>2025-09-01T00:00:00Z</updated>
<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <em>xhtml</em></p></div></content></entry>
<entry><title>v0</title><summary>Just a summary</summary></entry>
</feed>`;
		const result = page(atom);
		assert.equal(result?.title, "Releases");
		assert.deepEqual(result?.meta, ["feed with 3 entries", "site: https://x.y"]);
		assert.equal(result?.text, ["## v2", "2025-10-06 · Bob · https://x.y/v2", "Notes", "## v1", "2025-09-01 · https://x.y/v1", "Inline *xhtml*", "## v0", "Just a summary"].join("\n\n"));
	});

	test("cuts long entries at a paragraph and says so", () => {
		const paragraphs = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i} ${"x".repeat(90)}</p>`).join("");
		const result = page(`<rss><channel><title>T</title><item><title>Long</title><description><![CDATA[${paragraphs}]]></description></item></channel></rss>`);
		assert.ok(result);
		assert.ok(result.text.endsWith(" […]"));
		assert.ok(result.text.length < 2100);
		assert.ok(result.text.includes("Paragraph 15"));
		assert.equal(result.meta?.at(-1), "entries over 2000 characters are cut: fetch an entry's link for the whole text");
	});

	test("keeps links in the content when asked", () => {
		const rss = `<rss><channel><title>T</title><item><title>E</title><link>https://x.y/e</link><description><![CDATA[<a href="/a">rel</a>]]></description></item></channel></rss>`;
		assert.equal(page(rss, "https://x.y/feed", true)?.text, "## E\n\nhttps://x.y/e\n\n[rel](https://x.y/a)");
	});
});

describe("sitemaps", () => {
	test("lists pages with their modification date", () => {
		const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://x.y/</loc><lastmod>2025-10-06T10:00:00+00:00</lastmod></url><url><loc>https://x.y/about</loc></url><url><lastmod>2025-01-01</lastmod></url></urlset>`;
		const result = page(xml, "https://x.y/sitemap.xml");
		assert.equal(result?.title, "Sitemap of x.y");
		assert.deepEqual(result?.meta, ["2 pages"]);
		assert.equal(result?.text, "https://x.y/ (2025-10-06)\nhttps://x.y/about");
	});

	test("lists the sitemaps of an index", () => {
		const xml = `<sitemapindex><sitemap><loc>https://x.y/s1.xml.gz</loc><lastmod>2025-10-06</lastmod></sitemap><sitemap><loc>https://x.y/s2.xml.gz</loc></sitemap></sitemapindex>`;
		const result = page(xml, "https://x.y/sitemap.xml");
		assert.equal(result?.title, "Sitemap index of x.y");
		assert.deepEqual(result?.meta, ["2 sitemaps: fetch one to list its pages"]);
		assert.equal(result?.text, "https://x.y/s1.xml.gz (2025-10-06)\nhttps://x.y/s2.xml.gz");
	});
});
