import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { indexQuery } from "../extensions/sources/brave-index.ts";
import { parseIssueUrl, rawFileUrl } from "../extensions/sources/github.ts";
import { decodeEntities, parseQuestionUrl } from "../extensions/sources/stack-exchange.ts";

const url = (href: string) => new URL(href);

describe("GitHub", () => {
	test("recognizes issues and pull requests, not their diffs", () => {
		assert.deepEqual(parseIssueUrl(url("https://github.com/nodejs/node/issues/52554")), { owner: "nodejs", repo: "node", number: "52554", isPull: false });
		assert.deepEqual(parseIssueUrl(url("https://github.com/a/b/pull/7/files")), { owner: "a", repo: "b", number: "7", isPull: true });
		assert.equal(parseIssueUrl(url("https://github.com/a/b/pull/7.diff")), undefined);
		assert.equal(parseIssueUrl(url("https://gitlab.com/a/b/issues/7")), undefined);
	});

	test("maps file pages to raw files", () => {
		assert.equal(rawFileUrl(url("https://github.com/a/b/blob/main/src/x.ts"))?.href, "https://raw.githubusercontent.com/a/b/main/src/x.ts");
		assert.equal(rawFileUrl(url("https://github.com/a/b/tree/main/src")), undefined);
	});
});

describe("Stack Exchange", () => {
	test("finds the question and the linked answer", () => {
		const so = "https://stackoverflow.com/questions/14220321/how-do-i-return";
		assert.deepEqual(parseQuestionUrl(url(so)), { site: "stackoverflow.com", questionId: "14220321", answerId: undefined });
		assert.deepEqual(parseQuestionUrl(url(`${so}/14220323`)), { site: "stackoverflow.com", questionId: "14220321", answerId: "14220323" });
		assert.deepEqual(parseQuestionUrl(url(`${so}#14220323`)), { site: "stackoverflow.com", questionId: "14220321", answerId: "14220323" });
		assert.deepEqual(parseQuestionUrl(url("https://stackoverflow.com/a/5")), { site: "stackoverflow.com", answerId: "5" });
	});

	test("covers the whole network and nothing else", () => {
		assert.equal(parseQuestionUrl(url("https://unix.stackexchange.com/q/1"))?.site, "unix.stackexchange.com");
		assert.equal(parseQuestionUrl(url("https://superuser.com/questions/2/x"))?.questionId, "2");
		assert.equal(parseQuestionUrl(url("https://stackoverflow.com/users/1")), undefined);
		assert.equal(parseQuestionUrl(url("https://notstackoverflow.com/questions/1")), undefined);
	});

	test("decodes the HTML entities of the API", () => {
		assert.equal(decodeEntities("&#191;C&#243;mo &amp;rarr; &quot;x&quot; &#x41; &unknown;"), '¿Cómo &rarr; "x" A &unknown;');
	});
});

describe("Brave index query", () => {
	test("uses the words of the URL slug", () => {
		assert.equal(indexQuery(url("https://www.reddit.com/r/rust/comments/1moh69c/rust_learner_here/")), "rust learner here");
		assert.equal(indexQuery(url("https://medium.com/@user/incremental-backups-in-postgresql-89096167b31b")), "incremental backups in postgresql");
		assert.equal(indexQuery(url("https://crates.io/")), "crates.io");
	});
});
