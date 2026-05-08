// Verifies the Pi-side deriveProjectName is consistent with the worker-side
// getProjectName: same cwd should produce the same project string in both
// engines so memories aren't fragmented across "pi-foo" vs "foo" or worktree
// vs parent.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveProjectName,
	parentRepoFromWorktree,
	shouldUseParentForWorktrees,
} from "../pi-agent/extensions/derive-project-name.js";
import { getProjectName } from "../src/utils/project-name.js";

describe("pi-mem deriveProjectName", () => {
	const ORIG_PI_PROJECT = process.env.PI_MEM_PROJECT;
	const ORIG_OPT_OUT = process.env.CLAUDE_MEM_WORKTREE_PARENT;

	let root: string;
	let parentRepo: string;
	let worktreeRepo: string;
	let nonGitDir: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "pi-mem-pi-derive-"));
		parentRepo = join(root, "Development", "repo-beta");
		mkdirSync(join(parentRepo, ".git", "worktrees", "brisbane"), {
			recursive: true,
		});
		worktreeRepo = join(
			root,
			"conductor",
			"workspaces",
			"repo-beta",
			"brisbane",
		);
		mkdirSync(worktreeRepo, { recursive: true });
		writeFileSync(
			join(worktreeRepo, ".git"),
			`gitdir: ${join(parentRepo, ".git", "worktrees", "brisbane")}\n`,
			"utf8",
		);
		nonGitDir = join(root, "scratch");
		mkdirSync(nonGitDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
		if (ORIG_PI_PROJECT === undefined) delete process.env.PI_MEM_PROJECT;
		else process.env.PI_MEM_PROJECT = ORIG_PI_PROJECT;
		if (ORIG_OPT_OUT === undefined)
			delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		else process.env.CLAUDE_MEM_WORKTREE_PARENT = ORIG_OPT_OUT;
	});

	it("PI_MEM_PROJECT env var wins over everything else", () => {
		process.env.PI_MEM_PROJECT = "explicit-name";
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(deriveProjectName(worktreeRepo)).toBe("explicit-name");
		delete process.env.PI_MEM_PROJECT;
	});

	it("returns parent repo name from inside a worktree", () => {
		delete process.env.PI_MEM_PROJECT;
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(deriveProjectName(worktreeRepo)).toBe("repo-beta");
		expect(parentRepoFromWorktree(worktreeRepo)).toBe("repo-beta");
	});

	it("returns null from parentRepoFromWorktree for main checkout", () => {
		expect(parentRepoFromWorktree(parentRepo)).toBeNull();
	});

	it("returns basename for main checkout (matches getProjectName)", () => {
		delete process.env.PI_MEM_PROJECT;
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(deriveProjectName(parentRepo)).toBe("repo-beta");
		expect(getProjectName(parentRepo)).toBe("repo-beta");
	});

	it("returns basename for non-git dir (no pi- prefix anymore)", () => {
		delete process.env.PI_MEM_PROJECT;
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(deriveProjectName(nonGitDir)).toBe("scratch");
		expect(deriveProjectName(nonGitDir)).toBe(getProjectName(nonGitDir));
	});

	it("CLAUDE_MEM_WORKTREE_PARENT=0 opts out (worktree basename)", () => {
		delete process.env.PI_MEM_PROJECT;
		process.env.CLAUDE_MEM_WORKTREE_PARENT = "0";
		expect(shouldUseParentForWorktrees()).toBe(false);
		expect(deriveProjectName(worktreeRepo)).toBe("brisbane");
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
	});

	it("Pi-side and worker-side produce the same string for any cwd (the whole point)", () => {
		delete process.env.PI_MEM_PROJECT;
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		for (const cwd of [parentRepo, worktreeRepo, nonGitDir]) {
			expect(deriveProjectName(cwd)).toBe(getProjectName(cwd));
		}
	});
});
