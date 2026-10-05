import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { cutPoint, omittedSections, truncate } from "../extensions/truncate.ts";

describe("cutPoint", () => {
	test("prefers the last paragraph break near the limit", () => {
		assert.equal(cutPoint(`${"a".repeat(85)}\n\n${"b".repeat(50)}`, 100), 85);
	});

	test("falls back to a line break, then to the limit", () => {
		assert.equal(cutPoint(`${"a".repeat(90)}\n${"b".repeat(50)}`, 100), 90);
		assert.equal(cutPoint(`${"a".repeat(10)}\n\n${"b".repeat(200)}`, 100), 100);
	});
});

describe("omittedSections", () => {
	test("lists the headings at the highest level present", () => {
		assert.deepEqual(omittedSections("### Intro\ntext\n## API\n### Detail\n## FAQ"), ["API", "FAQ"]);
		assert.deepEqual(omittedSections("### Chapter 1\n### Chapter 2"), ["Chapter 1", "Chapter 2"]);
		assert.deepEqual(omittedSections("no headings"), []);
	});
});

describe("truncate", () => {
	test("leaves short text alone", async () => {
		assert.deepEqual(await truncate("short", "x", 100), { text: "short" });
	});

	test("cuts long text, saves it whole and points to it", async () => {
		const text = `${"a".repeat(90)}\n\n## Next\n${"b".repeat(50)}`;
		const result = await truncate(text, "example.com/page", 100);
		assert.ok(result.fullPath);
		assert.equal(await readFile(result.fullPath, "utf8"), text);
		assert.ok(result.text.startsWith(`${"a".repeat(90)}\n\n[Truncated at 90 of ${text.length} characters.`));
		assert.match(result.text, /continue from line 2\)\. Sections not shown: Next\.\]$/);
	});
});
