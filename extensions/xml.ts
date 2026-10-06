// Feeds and sitemaps as an index of what a site publishes, instead of the XML that describes it.

import { DOMParser } from "linkedom";
import { type FetchOptions, isoDate, type Page } from "./core.ts";
import { cleanMarkdown, htmlToMarkdown } from "./markdown.ts";
import { cutPoint } from "./truncate.ts";

/** Characters kept of each entry's content: a feed is an index, and the entry's link leads to the whole text. */
const MAX_ENTRY_CHARS = 2000;

/** What may precede the root element: BOM, XML declaration, processing instructions (xml-stylesheet), comments, DOCTYPE. */
const PROLOGUE = /^(?:\uFEFF|\s+|<\?[^]*?\?>|<!--[^]*?-->|<!DOCTYPE[^>]*>)*/i;
const ROOTS = /^<(rss|rdf:RDF|feed|urlset|sitemapindex)[\s>]/;

/** The root element of a feed or a sitemap, found without parsing; undefined for any other text. */
export function xmlRoot(text: string): string | undefined {
	return text.slice(0, 2048).replace(PROLOGUE, "").match(ROOTS)?.[1];
}

/** A feed or a sitemap as markdown; undefined for anything else, including XML that does not parse. */
export function xmlToPage(text: string, url: URL, options: FetchOptions): Page | undefined {
	const root = xmlRoot(text);
	if (!root) return undefined;
	let document: Element;
	try {
		// linkedom types its XML elements apart from the DOM's; they behave the same for what is used here.
		document = new DOMParser().parseFromString(text, "text/xml").documentElement as unknown as Element;
	} catch {
		return undefined;
	}
	switch (root) {
		case "feed":
			return renderFeed(atomFeed(document), url, options);
		case "rss":
		case "rdf:RDF":
			return renderFeed(rssFeed(document), url, options);
		case "urlset":
			return sitemap(document, "url", url);
		default:
			return sitemap(document, "sitemap", url);
	}
}

const children = (element: Element | undefined, name: string): Element[] => (element ? Array.from(element.children).filter((child) => child.nodeName === name) : []);

/** The first child among the given names, in order of preference. */
function child(element: Element | undefined, ...names: string[]): Element | undefined {
	for (const name of names) {
		const found = children(element, name)[0];
		if (found) return found;
	}
	return undefined;
}

const text = (element: Element | undefined, ...names: string[]): string | undefined => child(element, ...names)?.textContent?.trim() || undefined;

interface Feed {
	title?: string;
	site?: string;
	entries: Entry[];
}
interface Entry {
	title?: string;
	link?: string;
	date?: string;
	author?: string;
	content?: Content;
}
/** An entry's content, as the feed marks it up. */
type Content = { html: string } | { text: string };

function rssFeed(root: Element): Feed {
	const channel = child(root, "channel");
	// Items are inside the channel in RSS 2.0, beside it in RSS 1.0 (RDF).
	const entries = Array.from(root.getElementsByTagName("item")).map((item): Entry => {
		const guid = child(item, "guid");
		const permalink = guid?.getAttribute("isPermaLink") !== "false" && /^https?:/.test(guid?.textContent ?? "") ? guid?.textContent?.trim() : undefined;
		return {
			title: text(item, "title"),
			link: text(item, "link") ?? permalink,
			date: text(item, "pubDate", "dc:date"),
			author: text(item, "dc:creator", "author"),
			content: rssContent(text(item, "content:encoded", "description")),
		};
	});
	return { title: text(channel, "title"), site: text(channel, "link"), entries };
}

/** RSS does not say whether a description is HTML or text. */
const rssContent = (value?: string): Content | undefined => (value === undefined ? undefined : /<[a-z][^>]*>/i.test(value) ? { html: value } : { text: value });

function atomFeed(root: Element): Feed {
	return {
		title: text(root, "title"),
		site: atomLink(root),
		entries: children(root, "entry").map((entry) => ({
			title: text(entry, "title"),
			link: atomLink(entry),
			date: text(entry, "published", "updated"),
			author: text(child(entry, "author"), "name"),
			content: atomContent(child(entry, "content", "summary")),
		})),
	};
}

/** The alternate link, or the first one: the page the entry (or the feed) is about. */
function atomLink(element: Element): string | undefined {
	const links = children(element, "link");
	const link = links.find((candidate) => (candidate.getAttribute("rel") ?? "alternate") === "alternate") ?? links[0];
	return link?.getAttribute("href") ?? undefined;
}

/** Atom declares its content: escaped HTML, inline XHTML, or text. */
function atomContent(element?: Element): Content | undefined {
	if (!element) return undefined;
	const type = element.getAttribute("type") ?? "text";
	if (type === "xhtml") return { html: element.innerHTML };
	return type.includes("html") ? { html: element.textContent ?? "" } : { text: element.textContent ?? "" };
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const count = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/** The content of an entry with its headings demoted below the entry's own (##): its highest level becomes ###. */
function nested(markdown: string): string {
	const levels = (markdown.match(/^#{1,6}(?= )/gm) ?? []).map((hashes) => hashes.length);
	const shift = levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
	return shift ? cleanMarkdown(markdown, { links: true, shiftHeadings: shift }) : markdown;
}

function renderFeed({ title, site, entries }: Feed, url: URL, { links }: FetchOptions): Page {
	let cut = false;
	const body = (entry: Entry): string => {
		if (!entry.content) return "";
		let markdown = "html" in entry.content ? nested(htmlToMarkdown(entry.content.html, { links, baseUrl: entry.link ?? url.href })) : collapse(entry.content.text);
		if (markdown.length > MAX_ENTRY_CHARS) {
			cut = true;
			markdown = `${markdown.slice(0, cutPoint(markdown, MAX_ENTRY_CHARS)).trimEnd()} […]`;
		}
		return markdown;
	};
	const sections = entries.map((entry) => {
		const heading = `## ${collapse(entry.title ?? "") || "(untitled)"}`;
		const source = [isoDate(entry.date) ?? entry.date, entry.author, entry.link].filter(Boolean).join(" · ");
		return [heading, source, body(entry)].filter(Boolean).join("\n\n");
	});

	const meta = [`feed with ${count(entries.length, "entry", "entries")}`];
	if (site) meta.push(`site: ${site}`);
	if (cut) meta.push(`entries over ${MAX_ENTRY_CHARS} characters are cut: fetch an entry's link for the whole text`);
	return { title, meta, text: sections.join("\n\n") };
}

/** One line per page (or per sitemap, in a sitemap index), with its last modification date. */
function sitemap(root: Element, item: "url" | "sitemap", url: URL): Page {
	const lines = children(root, item).flatMap((entry) => {
		const loc = text(entry, "loc");
		if (!loc) return [];
		const modified = isoDate(text(entry, "lastmod"));
		return [modified ? `${loc} (${modified})` : loc];
	});
	const index = item === "sitemap";
	return {
		title: `${index ? "Sitemap index" : "Sitemap"} of ${url.hostname}`,
		meta: [index ? `${count(lines.length, "sitemap")}: fetch one to list its pages` : count(lines.length, "page")],
		text: lines.join("\n"),
	};
}
