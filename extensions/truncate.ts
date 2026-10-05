import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Characters returned to the model. */
export const LIMIT = 30_000;
/** A paragraph or line break is preferred to an exact cut if it is at least this far into the limit. */
const MIN_CUT = 0.8;
const MAX_LISTED_SECTIONS = 20;

/** Where to cut: the last paragraph break before the limit, else the last line break, else the limit itself. */
export function cutPoint(text: string, limit = LIMIT): number {
	const near = (index: number) => (index >= limit * MIN_CUT ? index : -1);
	const paragraph = near(text.lastIndexOf("\n\n", limit));
	if (paragraph >= 0) return paragraph;
	const line = near(text.lastIndexOf("\n", limit));
	return line >= 0 ? line : limit;
}

/** Headings of the omitted text, at the highest level it uses (## in documentation, ### for video chapters...). */
export function omittedSections(rest: string): string[] {
	const headings = rest.match(/^#{1,6} .+$/gm) ?? [];
	const level = Math.min(...headings.map((heading) => heading.indexOf(" ")));
	return headings.filter((heading) => heading.indexOf(" ") === level).map((heading) => heading.slice(level + 1));
}

let directory: Promise<string> | undefined;

/** Keep the first LIMIT characters; the full text goes to a temporary file the note points to. */
export async function truncate(text: string, name: string, limit = LIMIT): Promise<{ text: string; fullPath?: string }> {
	if (text.length <= limit) return { text };

	directory ??= mkdtemp(join(tmpdir(), "pi-web-fetch-"));
	const fullPath = join(await directory, `${name.replace(/[^\w.-]+/g, "_").slice(0, 100)}-${Date.now()}.md`);
	await writeFile(fullPath, text);

	const cut = cutPoint(text, limit);
	const shown = text.slice(0, cut);
	const nextLine = shown.split("\n").length + 1;
	const sections = omittedSections(text.slice(cut));

	let note = `[Truncated at ${cut} of ${text.length} characters. Full text: ${fullPath} (continue from line ${nextLine}).`;
	if (sections.length) {
		const listed = sections.slice(0, MAX_LISTED_SECTIONS).join(" | ");
		note += ` Sections not shown: ${listed}${sections.length > MAX_LISTED_SECTIONS ? " | …" : ""}.`;
	}
	return { text: `${shown}\n\n${note}]`, fullPath };
}
