import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Page } from "./core.ts";
import { fetchPage } from "./fetch-page.ts";
import { LIMIT, truncate } from "./truncate.ts";

const TIMEOUT_MS = 30_000;

const parameters = Type.Object({
	url: Type.String({ description: "http(s) URL to fetch" }),
	links: Type.Optional(Type.Boolean({ description: "Keep hyperlinks (default: false, to save tokens). Set it to follow the page's links." })),
	language: Type.Optional(Type.String({ description: "Preferred language as a BCP 47 tag, e.g. 'it'. Also selects the YouTube transcript. Default: English." })),
});

interface Details {
	url: string;
	/** Length of the full content. */
	characters?: number;
	/** File holding the full content, when it was truncated. */
	fullPath?: string;
}

export default function webFetch(pi: ExtensionAPI) {
	pi.registerTool<typeof parameters, Details>({
		name: "web_fetch",
		label: "Web Fetch",
		description: [
			"Fetch a URL and return its main content as compact markdown, without navigation, ads or images.",
			"Handles web pages, documentation (as markdown source when the site serves it), PDFs, plain text, JSON,",
			"images (returned for you to see), YouTube videos (transcript), GitHub files, issues and pull requests (with comments),",
			"and Stack Exchange questions (with all answers and comments).",
			`Content over ${LIMIT} characters is cut; the full text is saved to a file whose path is given.`,
			"For the diff of a GitHub pull request or commit, append .diff to its URL. To explore a repository's code, clone it.",
		].join(" "),
		promptSnippet: "Read a URL as markdown: web pages, docs, PDFs, images, YouTube transcripts, GitHub, Stack Overflow",
		promptGuidelines: ["Use web_fetch to read a URL instead of curl or a browser: it returns only the content, in far fewer tokens."],
		parameters,
		annotations: { readOnlyHint: true, openWorldHint: true },

		async execute(_toolCallId, params, signal) {
			const url = parseUrl(params.url);
			const timeout = AbortSignal.timeout(TIMEOUT_MS);
			const page = await fetchPage(url, {
				links: params.links ?? false,
				language: params.language,
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});

			if (page.image) {
				return { content: [{ type: "text", text: page.text }, { type: "image", ...page.image }], details: { url: url.href } };
			}
			const markdown = render(page);
			const { text, fullPath } = await truncate(markdown, `${url.hostname}${url.pathname}`);
			return { content: [{ type: "text", text }], details: { url: url.href, characters: markdown.length, fullPath } };
		},
	});
}

/** Accepts URLs without a scheme ("example.com/page"); only http and https. */
function parseUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
	} catch {
		throw new Error(`Invalid URL: ${input}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported protocol ${url.protocol}: only http and https`);
	return url;
}

function render({ title, meta, text }: Page): string {
	return [title && `# ${title}`, meta?.length ? meta.join(" · ") : undefined, text.trim()].filter(Boolean).join("\n\n");
}
