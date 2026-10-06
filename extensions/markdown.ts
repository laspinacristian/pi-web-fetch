// Compact markdown for a model's context: from the DOM of an article, or from markdown written by a site or user.

import { parseHTML } from "linkedom";

export interface MarkdownOptions {
	/** Keep hyperlinks as [text](url). Off by default: they cost tokens and are rarely needed. */
	links?: boolean;
	/** Resolves relative links. */
	baseUrl: string;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IMG", "PICTURE", "SVG", "VIDEO", "AUDIO", "IFRAME", "CANVAS", "BUTTON", "FORM", "INPUT", "SELECT", "TEXTAREA", "NAV"]);
const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "UL"]);

const isElement = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;
const isBlock = (node: Node) => isElement(node) && BLOCK.has(node.nodeName);

/** Wrap text in markdown markers, leaving its surrounding whitespace outside them. */
const wrap = (text: string, open: string, close = open) => (text.trim() ? text.replace(/^(\s*)([^]*?)(\s*)$/, `$1${open}$2${close}$3`) : text);
const collapse = (text: string) => text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();

export function domToMarkdown(root: Element, { links = false, baseUrl }: MarkdownOptions): string {
	const inlineChildren = (node: Node) => Array.from(node.childNodes, inline).join("");

	function inline(node: Node): string {
		if (node.nodeType === TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
		if (!isElement(node) || SKIP.has(node.nodeName)) return "";
		if (node.nodeName === "BR") return "\n";
		if (isBlock(node)) return ` ${block(node)} `;
		const text = inlineChildren(node);
		switch (node.nodeName) {
			case "CODE":
			case "KBD":
			case "SAMP":
				return wrap((node.textContent ?? "").replace(/\s+/g, " "), "`");
			case "STRONG":
			case "B":
				return wrap(text, "**");
			case "EM":
			case "I":
				return wrap(text, "*");
			case "A":
				return anchor(node, text);
			default:
				return text;
		}
	}

	function anchor(node: Element, text: string): string {
		const href = node.getAttribute("href") ?? "";
		// Same-page anchors without words are permalinks or citation markers: "¶", "#", "[12]".
		if (href.startsWith("#")) return /\p{L}/u.test(text) ? text : "";
		if (!links) return text;
		try {
			return wrap(text, "[", `](${new URL(href, baseUrl).href})`);
		} catch {
			return text;
		}
	}

	/** Children of a block: runs of inline nodes become paragraphs, block children are rendered on their own. */
	function blocks(node: Node): string {
		const parts: string[] = [];
		let run = "";
		const flush = () => {
			// Text that opens a line like a heading ("# Comments: 5") is not one: the markers are read structurally.
			if (run.trim()) parts.push(collapse(run).replace(/^(#{1,6})(?= )/gm, "\\$1"));
			run = "";
		};
		for (const child of node.childNodes) {
			if (isBlock(child)) {
				flush();
				const rendered = block(child as Element);
				if (rendered) parts.push(rendered);
			} else {
				run += inline(child);
			}
		}
		flush();
		return parts.join("\n\n");
	}

	function block(node: Element): string {
		const tag = node.nodeName;
		if (/^H[1-6]$/.test(tag)) {
			const text = collapse(inlineChildren(node)).replace(/\n+/g, " ");
			return text && `${"#".repeat(Number(tag[1]))} ${text}`;
		}
		switch (tag) {
			case "PRE": {
				// Defuddle normalizes code blocks and records their language in data-lang.
				const lang = (node.querySelector("[data-lang]") ?? node).getAttribute("data-lang") ?? "";
				return `\`\`\`${lang}\n${(node.textContent ?? "").replace(/^\n|\s+$/g, "")}\n\`\`\``;
			}
			case "HR":
				return "---";
			case "UL":
			case "OL":
				return list(node);
			case "TABLE":
				return table(node);
			case "BLOCKQUOTE":
				return `> ${blocks(node).replace(/\n/g, "\n> ")}`;
			default:
				return blocks(node);
		}
	}

	function list(node: Element): string {
		const ordered = node.nodeName === "OL";
		const start = Number(node.getAttribute("start")) || 1;
		return Array.from(node.children)
			.filter((child) => child.nodeName === "LI")
			.map((item, i) => {
				const marker = ordered ? `${start + i}. ` : "- ";
				return marker + blocks(item).replace(/\n+/g, `\n${" ".repeat(marker.length)}`);
			})
			.join("\n");
	}

	function table(node: Element): string {
		const rows = Array.from(node.querySelectorAll("tr")).filter((row) => row.closest("table") === node);
		// A table containing tables is page layout (Hacker News, old sites): render its cells as blocks.
		if (node.querySelector("table")) {
			return rows
				.map((row) => Array.from(row.children, blocks).filter(Boolean).join("\n\n"))
				.filter(Boolean)
				.join("\n\n");
		}
		const cells = rows
			.map((row) => Array.from(row.children, (cell) => collapse(blocks(cell)).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|")))
			.filter((row) => row.some(Boolean));
		// Drop the columns that are empty in every row.
		const width = Math.max(0, ...cells.map((row) => row.length));
		const columns = Array.from({ length: width }, (_, i) => i).filter((i) => cells.some((row) => row[i]));
		if (columns.length === 0) return "";
		if (columns.length === 1) return cells.map((row) => row[columns[0]]).filter(Boolean).join("\n");
		const line = (values: string[]) => `| ${values.join(" | ")} |`;
		const pick = (row: string[]) => columns.map((i) => row[i] ?? "");
		return [line(pick(cells[0])), line(columns.map(() => "---")), ...cells.slice(1).map((row) => line(pick(row)))].join("\n");
	}

	return block(root).replace(/\n{3,}/g, "\n\n").trim();
}

/** An HTML fragment (an article body, a comment) as markdown. */
export function htmlToMarkdown(html: string, options: MarkdownOptions): string {
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	return domToMarkdown(document.body, options);
}

export interface CleanOptions {
	/** Keep hyperlinks. */
	links?: boolean;
	/** Demote headings by this many levels, to nest a post (an answer, a comment) under the heading introducing it. */
	shiftHeadings?: number;
}

/** Markdown written by a site or user: drop images, HTML comments and (unless `links`) link targets. Code blocks are left untouched. */
export function cleanMarkdown(markdown: string, { links = false, shiftHeadings = 0 }: CleanOptions = {}): string {
	const prose = (text: string) => {
		text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<!--[^]*?-->/g, "");
		if (shiftHeadings) {
			text = text
				.replace(/^(?=\S)(.+)\n(=+|-+)[ \t]*$/gm, (_, title: string, underline: string) => `${underline[0] === "=" ? "#" : "##"} ${title}`)
				.replace(/^#{1,6}(?=\s)/gm, (hashes) => "#".repeat(Math.min(6, hashes.length + shiftHeadings)));
		}
		if (links) return text;
		return text
			.replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))+(?:\s+"[^"]*")?\)/g, "$1") // [text](url "title")
			.replace(/\[([^\]]+)\]\[\w+\]/g, "$1") // [text][ref]
			.replace(/^ {0,3}\[\w+\]:\s*\S+.*$/gm, ""); // [ref]: url
	};
	// split() with one capturing group alternates prose (even indexes) and fenced code blocks (odd indexes).
	// Fences may be ``` or ~~~, and indented when nested in a list item.
	return markdown
		.split(/(^[ \t]*(?:```[^]*?^[ \t]*```|~~~[^]*?^[ \t]*~~~))/m)
		.map((part, i) => (i % 2 ? part : prose(part)))
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
