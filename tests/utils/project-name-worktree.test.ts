import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getProjectContext,
	getProjectName,
} from "../../src/utils/project-name.js";

describe("getProjectName worktree consolidation", () => {
	let root: string;
	let parentRepo: string;
	let worktreeRepo: string;
	let nonGitDir: string;

	const ORIG_ENV_OPT_OUT = process.env.CLAUDE_MEM_WORKTREE_PARENT;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "pi-mem-wt-"));

		// Mimic Conductor layout:
		//   <root>/Development/repo-alpha/                    (main checkout, .git is a dir)
		//   <root>/conductor/workspaces/repo-alpha/brisbane/  (linked worktree, .git is a file)
		parentRepo = join(root, "Development", "repo-alpha");
		mkdirSync(join(parentRepo, ".git", "worktrees", "brisbane"), {
			recursive: true,
		});

		worktreeRepo = join(root, "conductor", "workspaces", "repo-alpha", "brisbane");
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
		if (ORIG_ENV_OPT_OUT === undefined) {
			delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		} else {
			process.env.CLAUDE_MEM_WORKTREE_PARENT = ORIG_ENV_OPT_OUT;
		}
	});

	it("returns the parent repo name when cwd is inside a worktree", () => {
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(getProjectName(worktreeRepo)).toBe("repo-alpha");
	});

	it("returns the basename for the main checkout (.git is a directory)", () => {
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(getProjectName(parentRepo)).toBe("repo-alpha");
	});

	it("returns the basename for non-git directories (no .git at all)", () => {
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		expect(getProjectName(nonGitDir)).toBe("scratch");
	});

	it("respects CLAUDE_MEM_WORKTREE_PARENT=0 opt-out (returns worktree basename)", () => {
		process.env.CLAUDE_MEM_WORKTREE_PARENT = "0";
		expect(getProjectName(worktreeRepo)).toBe("brisbane");
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
	});

	it("getProjectContext deduplicates allProjects when consolidation collapses primary→parent", () => {
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
		const ctx = getProjectContext(worktreeRepo);
		expect(ctx.isWorktree).toBe(true);
		expect(ctx.primary).toBe("repo-alpha");
		expect(ctx.parent).toBe("repo-alpha");
		expect(ctx.allProjects).toEqual(["repo-alpha"]);
	});

	it("getProjectContext keeps both names when opted out, for unified queries", () => {
		process.env.CLAUDE_MEM_WORKTREE_PARENT = "0";
		const ctx = getProjectContext(worktreeRepo);
		expect(ctx.isWorktree).toBe(true);
		expect(ctx.primary).toBe("brisbane");
		expect(ctx.parent).toBe("repo-alpha");
		expect(ctx.allProjects).toEqual(["repo-alpha", "brisbane"]);
		delete process.env.CLAUDE_MEM_WORKTREE_PARENT;
	});
});
