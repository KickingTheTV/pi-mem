// =============================================================================
// Project Name Derivation (Pi-side)
//
// Mirrors the worker-side getProjectName in src/utils/project-name.ts so that
// observations written from Pi sessions and from Claude Code hooks land under
// the same project namespace for any given cwd.
//
// Resolution order:
//   1. PI_MEM_PROJECT env var wins (explicit per-session override).
//   2. If cwd is inside a git worktree, return the parent repo name (so all
//      worktrees of one repo share a single memory namespace).
//   3. Otherwise return the cwd basename.
//
// Set CLAUDE_MEM_WORKTREE_PARENT=0 to disable step 2.
// =============================================================================

import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Parse a worktree's `.git` pointer file to find the parent repo path.
 * Returns null if cwd is not a worktree (no `.git`, `.git` is a directory,
 * or the pointer file doesn't have the expected `gitdir:` form).
 */
export function parentRepoFromWorktree(cwd: string): string | null {
	const gitPath = join(cwd, ".git");
	let stat;
	try {
		stat = statSync(gitPath);
	} catch {
		return null;
	}
	if (!stat.isFile()) {
		return null; // .git is a directory → main checkout, not a worktree
	}
	let content: string;
	try {
		content = readFileSync(gitPath, "utf-8").trim();
	} catch {
		return null;
	}
	const match = content.match(/^gitdir:\s*(.+)$/);
	if (!match) return null;
	// Format: gitdir: /abs/path/to/parent/.git/worktrees/<name>
	const worktreesMatch = match[1].match(
		/^(.+)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/,
	);
	if (!worktreesMatch) return null;
	return basename(worktreesMatch[1]);
}

export function shouldUseParentForWorktrees(): boolean {
	const v = process.env.CLAUDE_MEM_WORKTREE_PARENT;
	if (v === undefined || v === null || v === "") return true;
	return v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "no";
}

export function deriveProjectName(cwd: string): string {
	if (process.env.PI_MEM_PROJECT) {
		return process.env.PI_MEM_PROJECT;
	}
	if (shouldUseParentForWorktrees()) {
		const parent = parentRepoFromWorktree(cwd);
		if (parent) return parent;
	}
	return basename(cwd);
}
