import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalCommitInfo {
  sha: string;
  shortSha: string;
  branch: string;
}

/**
 * Reads the current commit + branch from a local git checkout. Uses
 * execFile (fixed argv, no shell) rather than exec — cwd is the only
 * caller-controlled input and is never interpolated into a command string.
 */
export async function getCurrentCommit(cwd: string): Promise<LocalCommitInfo> {
  const [{ stdout: sha }, { stdout: branch }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd }),
    execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
  ]);

  const trimmedSha = sha.trim();
  return {
    sha: trimmedSha,
    shortSha: trimmedSha.slice(0, 7),
    branch: branch.trim(),
  };
}
