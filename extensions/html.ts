import defuddleModule from "defuddle";
import { parseHTML } from "linkedom";
import { type FetchOptions, isoDate, type Page, Unreadable } from "./core.ts";
import { htmlToMarkdown } from "./markdown.ts";

// defuddle ships a UMD bundle typed as an ES module: in Node the default import is the class itself,
// while TypeScript (module "nodenext") sees the module object. The cast restores the class type.
const Defuddle = defuddleModule as unknown as typeof defuddleModule.default;

/** Below this, the extracted text is an app shell or a block page rather than content. */
const MIN_TEXT_LENGTH = 100;
const CHALLENGE_PAGE = /<title>\s*(Just a moment|Attention Required|Access Denied)/i;

/** The main content of an HTML page, as markdown. */
export async function htmlToPage(html: string, url: URL, { links, language }: FetchOptions): Promise<Page> {
	if (CHALLENGE_PAGE.test(html)) throw new Unreadable("the site answered with a bot-protection page");

	const { document } = parseHTML(html);
	// parseAsync lets Defuddle's site extractors call their APIs, e.g. for YouTube transcripts and Reddit comments.
	const article = await withoutConsole(() => new Defuddle(document, { url: url.href, removeImages: true, language }).parseAsync());
	const text = htmlToMarkdown(article.content, { links, baseUrl: url.href });
	if (text.length < MIN_TEXT_LENGTH) throw new Unreadable("the page has no readable content without JavaScript");

	const published = isoDate(article.published);
	return { title: article.title?.trim() || undefined, meta: published ? [`Published ${published}`] : [], text };
}

// Defuddle logs recoverable problems with console.*, which would draw over Pi's terminal UI.
// The console is muted while any extraction runs; the counter keeps concurrent calls from restoring it early.
let running = 0;
let saved: Pick<Console, "log" | "warn" | "error"> | undefined;

async function withoutConsole<T>(task: () => Promise<T>): Promise<T> {
	if (running++ === 0) {
		saved = { log: console.log, warn: console.warn, error: console.error };
		console.log = console.warn = console.error = () => {};
	}
	try {
		return await task();
	} finally {
		if (--running === 0) Object.assign(console, saved);
	}
}
