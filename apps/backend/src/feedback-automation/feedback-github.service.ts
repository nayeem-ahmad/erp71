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

export interface PrChecksSummary {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    /** True only when at least one check exists and none failed or is still running. */
    allPassed: boolean;
}

export interface PrReadiness {
    state: string;
    /** GitHub computes this asynchronously; null means "not determined yet" (treated as not-ready). */
    mergeable: boolean | null;
    headSha: string;
    merged: boolean;
    mergeCommitSha: string | null;
    checks: PrChecksSummary;
    /** The merge gate: green iff computePrGreen(checks, mergeable). */
    green: boolean;
}

/** Pure merge gate: a PR is green iff at least one check exists, all checks passed, and GitHub says it is mergeable. */
export function computePrGreen(checks: PrChecksSummary, mergeable: boolean | null): boolean {
    return checks.total >= 1 && checks.allPassed && mergeable === true;
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

    /** Fetches PR mergeability + CI check state so the panel can gate the Merge button. */
    async getPrReadiness(prNumber: number): Promise<PrReadiness> {
        const { token, owner, repo } = await this.getConfig();
        const pr = await this.githubGet<{
            state?: string;
            mergeable?: boolean | null;
            merged?: boolean;
            merge_commit_sha?: string | null;
            head?: { sha?: string };
        }>(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);

        const headSha = pr.head?.sha ?? '';
        const checks = headSha
            ? await this.summarizeChecks(owner, repo, headSha, token)
            : { total: 0, passed: 0, failed: 0, pending: 0, allPassed: false };
        const mergeable = pr.mergeable ?? null;

        return {
            state: pr.state ?? 'unknown',
            mergeable,
            headSha,
            merged: !!pr.merged,
            mergeCommitSha: pr.merge_commit_sha ?? null,
            checks,
            green: computePrGreen(checks, mergeable),
        };
    }

    /** Merges the PR with a merge commit. Throws with a descriptive message on 405/409/403. */
    async mergePullRequest(prNumber: number): Promise<{ merged: boolean; sha: string | null }> {
        const { token, owner, repo } = await this.getConfig();
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'erp71-feedback-agent',
            },
            body: JSON.stringify({ merge_method: 'merge' }),
        });
        const json = (await response.json()) as { merged?: boolean; sha?: string; message?: string };
        if (!response.ok) {
            throw new InternalServerErrorException(`Failed to merge PR #${prNumber}: ${json.message ?? response.status}`);
        }
        return { merged: !!json.merged, sha: json.sha ?? null };
    }

    /** Combines GitHub Actions check-runs with legacy commit statuses into one pass/fail/pending summary. */
    private async summarizeChecks(owner: string, repo: string, sha: string, token: string): Promise<PrChecksSummary> {
        const runsResp = await this.githubGet<{ check_runs?: Array<{ status?: string; conclusion?: string | null }> }>(
            `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
            token,
        );
        const statusResp = await this.githubGet<{ statuses?: Array<{ state?: string }> }>(
            `/repos/${owner}/${repo}/commits/${sha}/status`,
            token,
        );

        const PASS = new Set(['success', 'neutral', 'skipped']);
        const FAIL = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

        let total = 0;
        let passed = 0;
        let failed = 0;
        let pending = 0;

        for (const run of runsResp.check_runs ?? []) {
            total++;
            if (run.status !== 'completed') pending++;
            else if (run.conclusion && FAIL.has(run.conclusion)) failed++;
            else if (run.conclusion && PASS.has(run.conclusion)) passed++;
            else pending++; // unknown/absent conclusion — treat cautiously as not-yet-passed
        }
        // Only fold in legacy statuses that actually exist, so an empty combined status never blocks.
        for (const s of statusResp.statuses ?? []) {
            total++;
            if (s.state === 'success') passed++;
            else if (s.state === 'failure' || s.state === 'error') failed++;
            else pending++; // 'pending'
        }

        return { total, passed, failed, pending, allPassed: total > 0 && failed === 0 && pending === 0 };
    }

    private async githubGet<T>(pathname: string, token: string): Promise<T> {
        const response = await fetch(`https://api.github.com${pathname}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'erp71-feedback-agent',
            },
        });
        const json = (await response.json()) as T & { message?: string };
        if (!response.ok) {
            throw new InternalServerErrorException(`GitHub API ${pathname} failed: ${json?.message ?? response.status}`);
        }
        return json;
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
