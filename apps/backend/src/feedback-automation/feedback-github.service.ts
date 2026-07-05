import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const execFileAsync = promisify(execFile);

export interface RepoWorkspace {
    /** Absolute path to the cloned working tree, checked out on `baseBranch`. */
    dir: string;
    baseBranch: string;
    /** Removes the working tree and its credential scratch directory. */
    cleanup: () => Promise<void>;
}

export interface OpenPullRequestInput {
    title: string;
    body: string;
    head: string;
    base: string;
}

export interface OpenPullRequestResult {
    number: number;
    url: string;
}

/**
 * Wraps git + GitHub REST calls for the feedback-automation runner: cloning a
 * disposable working tree, committing/pushing a branch, and opening or
 * reverting a pull request. Credentials are written to a scratch `.netrc`
 * (never passed as a CLI argument or logged) and torn down with the worktree.
 */
@Injectable()
export class FeedbackGithubService {
    private readonly logger = new Logger(FeedbackGithubService.name);

    constructor(private readonly platformSettings: PlatformSettingsService) {}

    private async getConfig(): Promise<{ token: string; owner: string; repo: string; baseBranch: string }> {
        const settings = await this.platformSettings.getRawGroup('feedback_automation');
        const token = settings.github_token;
        const repoFull = settings.github_repo ?? 'nayeem-ahmad/erp71';
        const baseBranch = settings.github_base_branch ?? 'dev';
        if (!token) {
            throw new InternalServerErrorException('Feedback automation is not configured: set a GitHub token.');
        }
        const [owner, repo] = repoFull.split('/');
        if (!owner || !repo) {
            throw new InternalServerErrorException(`Invalid github_repo setting: "${repoFull}" (expected "owner/repo").`);
        }
        return { token, owner, repo, baseBranch };
    }

    /** Clones a shallow, disposable working tree of the configured repo/base branch. */
    async createWorkspace(): Promise<RepoWorkspace> {
        const { token, owner, repo, baseBranch } = await this.getConfig();

        const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-agent-home-'));
        const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-agent-repo-'));
        await this.writeNetrc(scratchDir, token);
        const env = this.gitEnv(scratchDir);

        try {
            await execFileAsync(
                'git',
                ['clone', '--depth', '1', '--branch', baseBranch, `https://github.com/${owner}/${repo}.git`, repoDir],
                { env },
            );
        } catch (err) {
            await this.safeRemove(scratchDir);
            await this.safeRemove(repoDir);
            throw new InternalServerErrorException(`Failed to clone ${owner}/${repo}@${baseBranch}: ${this.errMsg(err)}`);
        }

        return {
            dir: repoDir,
            baseBranch,
            cleanup: async () => {
                await this.safeRemove(scratchDir);
                await this.safeRemove(repoDir);
            },
        };
    }

    /** Creates a branch, commits everything currently in the working tree, and pushes it. */
    async commitAndPush(workspace: RepoWorkspace, branch: string, message: string): Promise<void> {
        const { token, owner, repo } = await this.getConfig();
        const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-agent-home-'));
        await this.writeNetrc(scratchDir, token);
        const env = this.gitEnv(scratchDir);

        try {
            await execFileAsync('git', ['checkout', '-b', branch], { cwd: workspace.dir, env });
            await execFileAsync('git', ['add', '-A'], { cwd: workspace.dir, env });
            await execFileAsync(
                'git',
                ['-c', 'user.email=feedback-agent@erp71.com', '-c', 'user.name=ERP71 Feedback Agent', 'commit', '-m', message],
                { cwd: workspace.dir, env },
            );
            await execFileAsync(
                'git',
                ['push', `https://github.com/${owner}/${repo}.git`, `HEAD:refs/heads/${branch}`],
                { cwd: workspace.dir, env },
            );
        } catch (err) {
            throw new InternalServerErrorException(`Failed to commit/push branch ${branch}: ${this.errMsg(err)}`);
        } finally {
            await this.safeRemove(scratchDir);
        }
    }

    /** Reverts a single commit on a fresh branch off the base branch and pushes it. Throws if the revert conflicts. */
    async revertCommit(workspace: RepoWorkspace, sha: string, branch: string): Promise<void> {
        const { token, owner, repo } = await this.getConfig();
        const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-agent-home-'));
        await this.writeNetrc(scratchDir, token);
        const env = this.gitEnv(scratchDir);

        try {
            // The shallow clone may not contain the target commit's history — fetch it explicitly.
            await execFileAsync('git', ['fetch', '--depth', '2', 'origin', sha], { cwd: workspace.dir, env });
            await execFileAsync('git', ['checkout', '-b', branch], { cwd: workspace.dir, env });
            await execFileAsync(
                'git',
                ['-c', 'user.email=feedback-agent@erp71.com', '-c', 'user.name=ERP71 Feedback Agent', 'revert', '--no-edit', sha],
                { cwd: workspace.dir, env },
            );
            await execFileAsync(
                'git',
                ['push', `https://github.com/${owner}/${repo}.git`, `HEAD:refs/heads/${branch}`],
                { cwd: workspace.dir, env },
            );
        } catch (err) {
            throw new InternalServerErrorException(
                `Failed to revert ${sha}: ${this.errMsg(err)}. This usually means later changes conflict with the revert — resolve manually.`,
            );
        } finally {
            await this.safeRemove(scratchDir);
        }
    }

    async openPullRequest(input: OpenPullRequestInput): Promise<OpenPullRequestResult> {
        const { token, owner, repo } = await this.getConfig();

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'erp71-feedback-agent',
            },
            body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
        });

        const json = (await response.json()) as { number?: number; html_url?: string; message?: string };
        if (!response.ok) {
            throw new InternalServerErrorException(`Failed to open PR: ${json.message ?? response.status}`);
        }
        return { number: json.number!, url: json.html_url! };
    }

    async getPullRequestStatus(prNumber: number): Promise<{ merged: boolean; mergeCommitSha: string | null; state: string }> {
        const { token, owner, repo } = await this.getConfig();
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'erp71-feedback-agent',
            },
        });
        const json = (await response.json()) as { merged?: boolean; merge_commit_sha?: string | null; state?: string; message?: string };
        if (!response.ok) {
            throw new InternalServerErrorException(`Failed to fetch PR #${prNumber} status: ${json.message ?? response.status}`);
        }
        return { merged: !!json.merged, mergeCommitSha: json.merge_commit_sha ?? null, state: json.state ?? 'unknown' };
    }

    private gitEnv(homeDir: string): NodeJS.ProcessEnv {
        return { ...process.env, HOME: homeDir, GIT_TERMINAL_PROMPT: '0' };
    }

    private async writeNetrc(homeDir: string, token: string): Promise<void> {
        const netrcPath = path.join(homeDir, '.netrc');
        await fs.writeFile(netrcPath, `machine github.com\nlogin x-access-token\npassword ${token}\n`, { mode: 0o600 });
    }

    private async safeRemove(dir: string): Promise<void> {
        await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
            this.logger.warn(`Failed to clean up ${dir}: ${this.errMsg(err)}`);
        });
    }

    private errMsg(err: unknown): string {
        if (err && typeof err === 'object' && 'stderr' in err) {
            const stderr = String((err as { stderr?: unknown }).stderr ?? '');
            if (stderr) return stderr;
        }
        return err instanceof Error ? err.message : String(err);
    }
}
