import { extractText, getDocumentProxy } from "unpdf";
import { browserFetch, errorMessage, type FetchOptions, type HttpResponse, isAbort, type Page, type Source, Unreadable } from "./core.ts";
import { htmlToPage } from "./html.ts";
import { cleanMarkdown } from "./markdown.ts";
import { readFromBraveIndex } from "./sources/brave-index.ts";
import { github, rawFileUrl } from "./sources/github.ts";
import { stackExchange } from "./sources/stack-exchange.ts";

const SOURCES: Source[] = [github, stackExchange];
/** Statuses that mean "not for scripts" rather than "not found". */
const REFUSED = new Set([401, 403, 429, 451, 503]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Read a URL: through a site's API when one is better than its HTML, otherwise directly, and from Brave's index
 * when the site refuses the request or the page is empty without JavaScript.
 */
export async function fetchPage(url: URL, options: FetchOptions): Promise<Page> {
	const notes: string[] = [];
	for (const source of SOURCES) {
		try {
			const page = await source.read(url, options);
			if (page) return page;
		} catch (error) {
			if (isAbort(error)) throw error;
			notes.push(`${source.name} API unavailable (${errorMessage(error)})`);
		}
	}

	const withNotes = (page: Page): Page => (notes.length ? { ...page, meta: [...(page.meta ?? []), ...notes] } : page);
	const target = canonicalUrl(url);
	try {
		return withNotes(await readDirectly(target, options));
	} catch (error) {
		if (!(error instanceof Unreadable)) throw error;
		let indexProblem = "";
		const indexed = await readFromBraveIndex(target, options).catch((indexError: unknown) => {
			if (isAbort(indexError)) throw indexError;
			indexProblem = ` (Brave index lookup failed: ${errorMessage(indexError)})`;
			return undefined;
		});
		if (indexed) return withNotes(indexed);
		const apiProblems = notes.map((note) => ` ${note}.`).join("");
		throw new Error(`Cannot read ${url.href}: ${error.message}${indexProblem}.${apiProblems} A real browser may be needed.`);
	}
}

/** The form of a URL that reads best. */
function canonicalUrl(url: URL): URL {
	const raw = rawFileUrl(url);
	if (raw) return raw;
	// Defuddle's Reddit extractor and Brave's index work with www.reddit.com.
	if (/^(old|new|np|m)\.reddit\.com$/.test(url.hostname)) {
		const www = new URL(url);
		www.hostname = "www.reddit.com";
		return www;
	}
	return url;
}

async function readDirectly(url: URL, options: FetchOptions): Promise<Page> {
	const response = await browserFetch(url.href, {
		headers: {
			// Many documentation sites (Cloudflare, Stripe, Vercel, GitHub Docs, Next.js...) serve their markdown source on request.
			Accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5",
			"Accept-Language": options.language ? `${options.language}, en;q=0.5` : "en-US, en;q=0.9",
		},
		signal: options.signal,
	});
	if (REFUSED.has(response.status)) throw new Unreadable(`the site refused the request (HTTP ${response.status})`);
	if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
	return readResponse(response, url, options);
}

async function readResponse(response: HttpResponse, url: URL, options: FetchOptions): Promise<Page> {
	const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

	if (type === "text/markdown" || type === "text/x-markdown") return { text: cleanMarkdown(await response.text(), options) };

	if (type === "application/pdf") {
		const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
		const text = (await extractText(pdf, { mergePages: true })).text.trim();
		if (!text) throw new Error("the PDF has no text layer (scanned pages?): its text cannot be extracted");
		return { text };
	}

	if (IMAGE_TYPES.has(type)) {
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image too large to show (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
		return { text: `Image ${url.href} (${type}, ${Math.round(bytes.length / 1024)} KB)`, image: { data: bytes.toString("base64"), mimeType: type } };
	}

	if (type === "" || type.includes("html")) return htmlToPage(await response.text(), url, options);

	if (type.startsWith("text/") || /json|xml|javascript/.test(type)) return { text: await response.text() };

	throw new Error(`unsupported content type: ${type}`);
}
