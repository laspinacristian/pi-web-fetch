// Stack Overflow and the other Stack Exchange sites block scripts, but their API is open (300 requests/day per IP without a key).

import { type FetchOptions, getJson, isoDate, type Page, type Source } from "../core.ts";
import { cleanMarkdown, htmlToMarkdown } from "../markdown.ts";

interface Owner {
	display_name?: string;
}
interface Post {
	owner?: Owner;
	score: number;
	creation_date: number;
	/** Occasionally missing from the API's answers. */
	body_markdown?: string;
}
interface Answer extends Post {
	answer_id: number;
	is_accepted: boolean;
}
interface Question extends Post {
	question_id: number;
	title: string;
	answer_count: number;
	tags: string[];
	answers?: Answer[];
}
interface Comment {
	post_id: number;
	owner?: Owner;
	score: number;
	creation_date: number;
	/** HTML: the API no longer returns comments as markdown. */
	body: string;
}
interface Wrapper<T> {
	items: T[];
	has_more: boolean;
}

const SITES = /(^|\.)(stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net|stackapps\.com)$/;
/** Question and answers with body_markdown (created with /2.3/filters/create). */
const QUESTION_FILTER = "!)RL-JogHwoZuazwxM.funK5M";
/** The API takes up to 100 post ids per request and returns up to 100 items per page. */
const MAX_IDS = 100;
const MAX_COMMENT_PAGES = 5;

export interface QuestionRef {
	/** The API accepts the site's domain. */
	site: string;
	questionId?: string;
	/** The answer the URL points to, shown first. */
	answerId?: string;
}

/** /questions/<id>[/<slug>[/<answer>]][#<answer>], /q/<id>, /a/<answer>. */
export function parseQuestionUrl(url: URL): QuestionRef | undefined {
	if (!SITES.test(url.hostname)) return undefined;
	const site = url.hostname;
	const answer = url.pathname.match(/^\/a\/(\d+)/);
	if (answer) return { site, answerId: answer[1] };
	const question = url.pathname.match(/^\/(?:questions|q)\/(\d+)(?:\/[^/]+\/(\d+))?/);
	if (!question) return undefined;
	return { site, questionId: question[1], answerId: question[2] ?? url.hash.match(/^#(\d+)$/)?.[1] };
}

export const stackExchange: Source = {
	name: "Stack Exchange",
	async read(url, options) {
		const ref = parseQuestionUrl(url);
		return ref && readQuestion(ref, options);
	},
};

async function readQuestion({ site, questionId, answerId }: QuestionRef, { links, signal }: FetchOptions): Promise<Page> {
	const api = <T>(path: string, query: Record<string, string>) =>
		getJson<Wrapper<T>>(`https://api.stackexchange.com/2.3${path}?${new URLSearchParams({ site, ...query })}`, signal);

	if (!questionId) {
		const [answer] = (await api<{ question_id: number }>(`/answers/${answerId}`, { filter: "default" })).items;
		if (!answer) throw new Error("answer not found");
		questionId = String(answer.question_id);
	}
	const [question] = (await api<Question>(`/questions/${questionId}`, { filter: QUESTION_FILTER })).items;
	if (!question) throw new Error("question not found");

	// The linked answer first, then the accepted one, then by score.
	const rank = (a: Answer) => (String(a.answer_id) === answerId ? 2 : a.is_accepted ? 1 : 0);
	const answers = [...(question.answers ?? [])].sort((a, b) => rank(b) - rank(a) || b.score - a.score);

	const comments = new Map<number, Comment[]>();
	let partial = false;
	const ids = [question.question_id, ...answers.map((a) => a.answer_id)];
	for (let i = 0; i < ids.length; i += MAX_IDS) {
		const batch = await listComments(api, ids.slice(i, i + MAX_IDS));
		partial ||= batch.partial;
		for (const comment of batch.comments) {
			comments.set(comment.post_id, [...(comments.get(comment.post_id) ?? []), comment]);
		}
	}

	const name = (owner?: Owner) => decodeEntities(owner?.display_name ?? "deleted user");
	const body = (post: Post) => (post.body_markdown ? cleanMarkdown(decodeEntities(post.body_markdown), { links, shiftHeadings: 2 }) : "*(text not available)*");
	const commentList = (postId: number) => {
		const list = comments.get(postId);
		if (!list) return "";
		const items = list.map((c) => `- ${name(c.owner)}${c.score ? ` (${c.score})` : ""}: ${htmlToMarkdown(c.body, { links, baseUrl: `https://${site}` })}`);
		return `\n\nComments:\n${items.join("\n")}`;
	};

	const sections = [body(question) + commentList(question.question_id)];
	for (const answer of answers) {
		const labels = [String(answer.answer_id) === answerId && "Linked answer", answer.is_accepted && "Accepted answer"].filter(Boolean);
		const heading = `## ${labels.join(", ") || "Answer"} · score ${answer.score} · ${name(answer.owner)} · ${isoDate(answer.creation_date)}`;
		sections.push(`${heading}\n\n${body(answer)}${commentList(answer.answer_id)}`);
	}

	const meta = [site, `score ${question.score}`, `${question.answer_count} answers`, `tags: ${question.tags.join(", ")}`, `asked ${isoDate(question.creation_date)} by ${name(question.owner)}`];
	if (partial) meta.push(`only the first ${MAX_COMMENT_PAGES * 100} comments are shown`);
	return { title: decodeEntities(question.title), meta, text: sections.join("\n\n") };
}

type Api = <T>(path: string, query: Record<string, string>) => Promise<Wrapper<T>>;

/** Comments of up to 100 posts, oldest first; `partial` when there were more than MAX_COMMENT_PAGES pages. */
async function listComments(api: Api, postIds: number[]): Promise<{ comments: Comment[]; partial: boolean }> {
	const comments: Comment[] = [];
	for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
		const batch = await api<Comment>(`/posts/${postIds.join(";")}/comments`, { filter: "withbody", sort: "creation", order: "asc", pagesize: "100", page: String(page) });
		comments.push(...batch.items);
		if (!batch.has_more) return { comments, partial: false };
	}
	return { comments, partial: true };
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The API HTML-escapes titles, names and even body_markdown. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
		return String.fromCodePoint(code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)));
	});
}
