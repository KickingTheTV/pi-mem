import { homedir } from 'os'
import path from 'path';
import { logger } from './logger.js';
import { detectWorktree } from './worktree.js';

/**
 * Toggle for routing all worktree writes/queries to the parent project name.
 *
 * When set to a truthy value, getProjectName() returns the parent repo name
 * for any cwd inside a git worktree (e.g. "rfd" instead of "brisbane" from
 * ~/conductor/workspaces/rfd/brisbane). This consolidates memory across all
 * worktrees of a repo so context-injection from any worktree (or from Pi or
 * Claude Code) sees a unified timeline.
 *
 * Default: enabled. Set CLAUDE_MEM_WORKTREE_PARENT=0 to opt out.
 */
function shouldUseParentForWorktrees(): boolean {
  const v = process.env.CLAUDE_MEM_WORKTREE_PARENT;
  if (v === undefined || v === null || v === '') return true;
  return v !== '0' && v.toLowerCase() !== 'false' && v.toLowerCase() !== 'no';
}

/**
 * Expand leading ~ to the user's home directory.
 * Handles "~", "~/", and "~/subpath" but not "~user/" (which is rare in cwd).
 */
function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return p.replace(/^~/, homedir())
  }
  return p
}

/**
 * Extract project name from working directory path
 * Handles edge cases: null/undefined cwd, drive roots, trailing slashes, unexpanded ~
 *
 * @param cwd - Current working directory (absolute path, or ~-prefixed path)
 * @returns Project name or "unknown-project" if extraction fails
 */
export function getProjectName(cwd: string | null | undefined): string {
  if (!cwd || cwd.trim() === '') {
    logger.warn('PROJECT_NAME', 'Empty cwd provided, using fallback', { cwd });
    return 'unknown-project';
  }

  // Expand leading ~ before path operations
  const expanded = expandTilde(cwd)

  // Worktree consolidation: if this cwd is inside a git worktree, prefer the
  // parent repo name so memories don't fragment across per-worktree namespaces
  // (e.g. "brisbane" / "seoul" / "albuquerque"). Opt-out via env var.
  if (shouldUseParentForWorktrees()) {
    try {
      const wt = detectWorktree(expanded);
      if (wt.isWorktree && wt.parentProjectName) {
        return wt.parentProjectName;
      }
    } catch {
      // fall through to basename
    }
  }

  // Extract basename (handles trailing slashes automatically)
  const basename = path.basename(expanded);

  // Edge case: Drive roots on Windows (C:\, J:\) or Unix root (/)
  // path.basename('C:\') returns '' (empty string)
  if (basename === '') {
    // Extract drive letter on Windows, or use 'root' on Unix
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const driveMatch = cwd.match(/^([A-Z]):\\/i);
      if (driveMatch) {
        const driveLetter = driveMatch[1].toUpperCase();
        const projectName = `drive-${driveLetter}`;
        logger.info('PROJECT_NAME', 'Drive root detected', { cwd, projectName });
        return projectName;
      }
    }
    logger.warn('PROJECT_NAME', 'Root directory detected, using fallback', { cwd });
    return 'unknown-project';
  }

  return basename;
}

/**
 * Project context with worktree awareness
 */
export interface ProjectContext {
  /** The current project name (worktree or main repo) */
  primary: string;
  /** Parent project name if in a worktree, null otherwise */
  parent: string | null;
  /** True if currently in a worktree */
  isWorktree: boolean;
  /** All projects to query: [primary] for main repo, [parent, primary] for worktree */
  allProjects: string[];
}

/**
 * Get project context with worktree detection.
 *
 * When in a worktree, returns both the worktree project name and parent project name
 * for unified timeline queries.
 *
 * @param cwd - Current working directory (absolute path)
 * @returns ProjectContext with worktree info
 */
export function getProjectContext(cwd: string | null | undefined): ProjectContext {
  const primary = getProjectName(cwd);

  if (!cwd) {
    return { primary, parent: null, isWorktree: false, allProjects: [primary] };
  }

  const expandedCwd = expandTilde(cwd);
  const worktreeInfo = detectWorktree(expandedCwd);

  if (worktreeInfo.isWorktree && worktreeInfo.parentProjectName) {
    // When CLAUDE_MEM_WORKTREE_PARENT consolidation is on (default),
    // primary === parentProjectName already, so dedupe in allProjects.
    if (primary === worktreeInfo.parentProjectName) {
      return {
        primary,
        parent: worktreeInfo.parentProjectName,
        isWorktree: true,
        allProjects: [primary]
      };
    }
    // Opt-out path: keep both names so queries see a unified timeline.
    return {
      primary,
      parent: worktreeInfo.parentProjectName,
      isWorktree: true,
      allProjects: [worktreeInfo.parentProjectName, primary]
    };
  }

  return { primary, parent: null, isWorktree: false, allProjects: [primary] };
}
