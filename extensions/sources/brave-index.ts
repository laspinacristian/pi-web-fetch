// Pages that refuse scripts (Reddit, JavaScript apps...) are often in Brave's index. The LLM Context API, restricted
// to the page's URL with a Goggle, returns the content Brave extracted when it crawled the page.

import { type FetchOptions, getJson, type Page } from "../core.ts";

interface LlmContext {
	grounding?: { generic?: { url: string; title: string; snippets: string[] }[] };
	sources?: Record<string, { age?: string[] }>;
}

const apiKey = () => process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;

/** The query only has to match the page: the words of its URL slug. */
export function indexQuery(url: URL): string {
	const slug = decodeURIComponent(url.pathname)
		.split("/")
		.filter((segment) => /\p{L}{3}/u.test(segment))
		.at(-1);
	const words = slug?.replace(/[-_+.]+/g, " ").replace(/\b[0-9a-f]{8,}\b/g, "").trim();
	return words || url.hostname;
}

const normalize = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");

/** The page as indexed by Brave, or undefined without a key or when the page is not indexed. */
export async function readFromBraveIndex(url: URL, { signal }: FetchOptions): Promise<Page | undefined> {
	const key = apiKey();
	if (!key) return undefined;
	const site = url.hostname.replace(/^www\./, "");
	const params = new URLSearchParams({
		q: indexQuery(url),
		goggles: `$discard\n${url.pathname}$boost=10,site=${site}`,
		maximum_number_of_tokens: "16384",
		maximum_number_of_tokens_per_url: "8192",
		context_threshold_mode: "disabled",
	});
	const data = await getJson<LlmContext>(`https://api.search.brave.com/res/v1/llm/context?${params}`, signal, {
		Accept: "application/json",
		"X-Subscription-Token": key,
	});
	const result = data.grounding?.generic?.find((r) => normalize(r.url) === normalize(url.href));
	if (!result) return undefined;
	const published = data.sources?.[result.url]?.age?.[1];
	const meta = ["From Brave's search index, as the site refuses direct access: passages may be incomplete"];
	if (published) meta.unshift(`Published ${published}`);
	return { title: result.title, meta, text: result.snippets.join("\n\n") };
}
