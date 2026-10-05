/** What a fetch produces: markdown text, or an image for the model to see. */
export interface Page {
	title?: string;
	/** Short facts shown under the title: date, origin, caveats. */
	meta?: string[];
	text: string;
	image?: { data: string; mimeType: string };
}

export interface FetchOptions {
	/** Keep hyperlinks in the markdown. */
	links: boolean;
	/** Preferred language (BCP 47). */
	language?: string;
	signal: AbortSignal;
}

/** A source that reads some URLs through an API. `read` resolves to undefined for URLs it does not handle. */
export interface Source {
	name: string;
	read(url: URL, options: FetchOptions): Promise<Page | undefined>;
}

/** The site refused the request, or the page has no content without JavaScript. */
export class Unreadable extends Error {}

export const isAbort = (error: unknown) => error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** ISO date (YYYY-MM-DD) of a date string or Unix timestamp; undefined for missing or relative dates ("3 months ago"). */
export function isoDate(value: string | number | undefined | null): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const date = new Date(typeof value === "number" ? value * 1000 : value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export interface HttpResponse {
	ok: boolean;
	status: number;
	statusText: string;
	headers: { get(name: string): string | null };
	text(): Promise<string>;
	arrayBuffer(): Promise<ArrayBuffer>;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<HttpResponse>;

// wreq-js presents Chrome's TLS and HTTP/2 fingerprint, which many bot protections check (npm, Medium, Real Python...).
// Node's fetch is the fallback when its native binary is not available for the platform.
const wreq = await import("wreq-js").catch(() => undefined);

/** Fetch for web pages, looking like a browser. */
export const browserFetch: Fetch = wreq ? (url, init) => wreq.fetch(url, { ...init, browser: "chrome" }) : (url, init) => fetch(url, init);

/** GET a JSON API with Node's fetch. */
export async function getJson<T>(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<T> {
	const response = await fetch(url, { headers, signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return (await response.json()) as T;
}
