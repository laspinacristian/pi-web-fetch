// GitHub issues and pull requests through the REST API: their HTML pages do not include the comments.

import { execFile } from "node:child_process";
import { type FetchOptions, getJson, isoDate, type Page, type Source } from "../core.ts";
import { cleanMarkdown } from "../markdown.ts";

interface User {
	login: string;
}
interface Issue {
	title: string;
	body: string | null;
	state: string;
	state_reason: string | null;
	user: User | null;
	created_at: string;
	labels: { name: string }[];
}
interface Comment {
	body: string | null;
	user: User | null;
	created_at: string;
}
interface ReviewComment extends Comment {
	path: string;
	line: number | null;
}
interface Review {
	body: string | null;
	user: User | null;
	state: string;
	submitted_at: string;
}
interface PullRequest {
	merged_at: string | null;
	additions: number;
	deletions: number;
	changed_files: number;
	base: { ref: string };
	head: { label: string };
}
interface ChangedFile {
	filename: string;
	additions: number;
	deletions: number;
}

/** Lists are read up to this many pages of 100 items. */
const MAX_PAGES = 3;

export interface IssueRef {
	owner: string;
	repo: string;
	number: string;
	isPull: boolean;
}

/** github.com/<owner>/<repo>/(issues|pull)/<number>[/...]. Not .diff and .patch URLs, which are plain text. */
export function parseIssueUrl(url: URL): IssueRef | undefined {
	if (url.hostname !== "github.com") return undefined;
	const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)(?:\/.*)?$/);
	return match ? { owner: match[1], repo: match[2], number: match[4], isPull: match[3] === "pull" } : undefined;
}

/** File pages render code with line numbers: the raw file reads better. */
export function rawFileUrl(url: URL): URL | undefined {
	if (url.hostname !== "github.com") return undefined;
	const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
	return match ? new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`) : undefined;
}

let token: Promise<string | undefined> | undefined;

/** GITHUB_TOKEN or GH_TOKEN, else the GitHub CLI's token if it is logged in. Read once, kept in memory. */
function githubToken(): Promise<string | undefined> {
	token ??= new Promise((resolve) => {
		const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
		if (fromEnv) return resolve(fromEnv);
		execFile("gh", ["auth", "token"], { timeout: 3000 }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined));
	});
	return token;
}

export const github: Source = {
	name: "GitHub",
	async read(url, options) {
		const ref = parseIssueUrl(url);
		return ref && readIssue(ref, url, options);
	},
};

async function readIssue({ owner, repo, number, isPull }: IssueRef, url: URL, { links, signal }: FetchOptions): Promise<Page> {
	const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "pi-web-fetch", "X-GitHub-Api-Version": "2022-11-28" };
	const auth = await githubToken();
	if (auth) headers.Authorization = `Bearer ${auth}`;
	const api = <T>(path: string) => getJson<T>(`https://api.github.com/repos/${owner}/${repo}${path}`, signal, headers);
	const list = async <T>(path: string): Promise<T[]> => {
		const items: T[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const batch = await api<T[]>(`${path}?per_page=100&page=${page}`);
			items.push(...batch);
			if (batch.length < 100) break;
		}
		return items;
	};

	const [issue, comments, pull, files, reviews, reviewComments] = await Promise.all([
		api<Issue>(`/issues/${number}`),
		list<Comment>(`/issues/${number}/comments`),
		isPull ? api<PullRequest>(`/pulls/${number}`) : undefined,
		isPull ? list<ChangedFile>(`/pulls/${number}/files`) : [],
		isPull ? list<Review>(`/pulls/${number}/reviews`) : [],
		isPull ? list<ReviewComment>(`/pulls/${number}/comments`) : [],
	]);

	// Posts are nested under "## Comments" and "### @author": their own headings are demoted below those.
	const post = (body: string | null, depth: number) => cleanMarkdown(body ?? "", { links, shiftHeadings: depth }) || "*(empty)*";
	const author = (user: User | null) => `@${user?.login ?? "ghost"}`;

	const state = pull?.merged_at ? `merged ${isoDate(pull.merged_at)}` : issue.state_reason ? `${issue.state} (${issue.state_reason})` : issue.state;
	const meta = [`${owner}/${repo}#${number}`, isPull ? "pull request" : "issue", state, `opened by ${author(issue.user)} on ${isoDate(issue.created_at)}`];
	if (issue.labels.length) meta.push(`labels: ${issue.labels.map((label) => label.name).join(", ")}`);
	if (pull) meta.push(`${pull.base.ref} ← ${pull.head.label}`, `+${pull.additions} −${pull.deletions} in ${pull.changed_files} files`);

	const conversation = [
		...comments.map((c) => ({ at: c.created_at, heading: `${author(c.user)} · ${isoDate(c.created_at)}`, body: c.body })),
		...reviews
			.filter((r) => r.body || r.state !== "COMMENTED")
			.map((r) => ({ at: r.submitted_at, heading: `${author(r.user)} · ${isoDate(r.submitted_at)} · review: ${r.state.toLowerCase().replace("_", " ")}`, body: r.body })),
	].sort((a, b) => a.at.localeCompare(b.at));

	const sections = [post(issue.body, 2)];
	if (files.length) sections.push(`## Files changed\n\n${files.map((f) => `- ${f.filename} (+${f.additions} −${f.deletions})`).join("\n")}`);
	if (conversation.length) sections.push(`## Comments\n\n${conversation.map((c) => `### ${c.heading}\n\n${post(c.body, 3)}`).join("\n\n")}`);
	if (reviewComments.length) {
		const items = reviewComments.map((c) => `### ${author(c.user)} on ${c.path}${c.line ? `:${c.line}` : ""} · ${isoDate(c.created_at)}\n\n${post(c.body, 3)}`);
		sections.push(`## Review comments on code\n\n${items.join("\n\n")}`);
	}
	if (isPull) sections.push(`Diff: ${url.origin}/${owner}/${repo}/pull/${number}.diff`);

	return { title: issue.title, meta, text: sections.join("\n\n") };
}
