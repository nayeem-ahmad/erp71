import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { FeedbackAgentRunnerService } from './feedback-agent-runner.service';
import { FeedbackGithubService } from './feedback-github.service';
import { PlanReviewDecision } from './feedback-automation.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BATCH_SIZE = 20;

// dev→main auto-promotion: how long to wait for the promotion PR's CI to go green before giving up.
const PROMOTE_POLL_MS = 30_000;
const PROMOTE_MAX_POLLS = 30; // ~15 minutes

/** Crude, deliberately conservative static scan — a real destructive change should never slip past a false negative here. */
const DESTRUCTIVE_SQL_PATTERN = /\b(DROP\s+(COLUMN|TABLE)|ALTER\s+COLUMN\s+"?\w+"?\s+(TYPE|SET\s+NOT\s+NULL)|TRUNCATE)\b/i;

@Injectable()
export class FeedbackAutomationService {
    private readonly logger = new Logger(FeedbackAutomationService.name);
    /** In-process guard so concurrent feedback merges don't each open a dev→main promotion PR. */
    private promoting = false;

    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly runner: FeedbackAgentRunnerService,
        private readonly github: FeedbackGithubService,
        private readonly audit: AuditService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    async getFeedbackWithPlans(feedbackId: string) {
        const feedback = await this.db.feedback.findUnique({
            where: { id: feedbackId },
            include: { plans: { orderBy: { version: 'desc' } }, tenant: { select: { name: true } }, user: { select: { email: true, name: true } } },
        });
        if (!feedback) throw new NotFoundException('Feedback not found');
        return feedback;
    }

    async saveInstruction(feedbackId: string, instruction: string, adminUserId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId } });
        if (!feedback) throw new NotFoundException('Feedback not found');

        const updated = await this.db.feedback.update({
            where: { id: feedbackId },
            data: {
                adminInstruction: instruction,
                status: feedback.status === 'NEW' ? 'ADMIN_REVIEWING' : feedback.status,
            },
        });
        await this.audit.log('feedback_automation.save_instruction', 'Feedback', { userId: adminUserId }, feedbackId, { instruction });
        return updated;
    }

    /** Kicks off plan proposal in the background and returns immediately — the agent can take well over a minute. */
    async requestPlan(feedbackId: string, adminUserId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId } });
        if (!feedback) throw new NotFoundException('Feedback not found');
        if (!feedback.adminInstruction) {
            throw new BadRequestException('Save an instruction for this feedback before requesting a plan.');
        }

        const updated = await this.db.feedback.update({
            where: { id: feedbackId },
            data: { status: 'PLAN_REQUESTED', lastError: null },
        });
        await this.audit.log('feedback_automation.request_plan', 'Feedback', { userId: adminUserId }, feedbackId);

        this.runPlanRequest(feedbackId).catch((err) => {
            this.logger.error(`Plan request failed for feedback ${feedbackId}: ${err instanceof Error ? err.message : String(err)}`);
        });

        return updated;
    }

    private async runPlanRequest(feedbackId: string): Promise<void> {
        try {
            const feedback = await this.db.feedback.findUniqueOrThrow({ where: { id: feedbackId }, include: { plans: { orderBy: { version: 'desc' }, take: 1 } } });
            const priorPlan = feedback.plans[0];
            const nextVersion = (priorPlan?.version ?? 0) + 1;

            const result = await this.runner.proposePlan({
                feedbackType: feedback.type,
                message: feedback.message,
                page: feedback.page,
                adminInstruction: feedback.adminInstruction!,
                priorPlan: priorPlan?.status === 'CHANGES_REQUESTED' ? priorPlan.planText : undefined,
                priorComment: priorPlan?.status === 'CHANGES_REQUESTED' ? (priorPlan.adminComment ?? undefined) : undefined,
            });

            await this.db.feedbackPlan.create({
                data: {
                    feedbackId,
                    version: nextVersion,
                    planText: result.planText,
                    hasMigration: result.hasMigration,
                    status: 'PROPOSED',
                },
            });
            await this.db.feedback.update({ where: { id: feedbackId }, data: { status: 'PLAN_PROPOSED' } });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.db.feedback.update({ where: { id: feedbackId }, data: { status: 'ADMIN_REVIEWING', lastError: message } });
            throw err;
        }
    }

    async reviewPlan(planId: string, decision: PlanReviewDecision, comment: string | undefined, confirmMigration: boolean | undefined, adminUserId: string) {
        const plan = await this.db.feedbackPlan.findUnique({ where: { id: planId } });
        if (!plan) throw new NotFoundException('Plan not found');
        if (plan.status !== 'PROPOSED') {
            throw new BadRequestException(`Plan is already ${plan.status.toLowerCase()}.`);
        }

        if (decision === PlanReviewDecision.REQUEST_CHANGES) {
            if (!comment) throw new BadRequestException('A comment is required when requesting changes.');
            await this.db.feedbackPlan.update({
                where: { id: planId },
                data: { status: 'CHANGES_REQUESTED', adminComment: comment, reviewedAt: new Date(), reviewedBy: adminUserId },
            });
            await this.db.feedback.update({ where: { id: plan.feedbackId }, data: { status: 'CHANGES_REQUESTED' } });
            await this.audit.log('feedback_automation.request_changes', 'FeedbackPlan', { userId: adminUserId }, planId, { comment });

            // Auto re-trigger the next plan version addressing the admin's comment.
            await this.db.feedback.update({ where: { id: plan.feedbackId }, data: { status: 'PLAN_REQUESTED' } });
            this.runPlanRequest(plan.feedbackId).catch((err) => {
                this.logger.error(`Plan revision failed for feedback ${plan.feedbackId}: ${err instanceof Error ? err.message : String(err)}`);
            });
            return this.getFeedbackWithPlans(plan.feedbackId);
        }

        // APPROVE
        const requireSignoff = (await this.platformSettings.getRawValue('feedback_automation', 'require_migration_signoff')) !== 'false';
        if (plan.hasMigration && requireSignoff && !confirmMigration) {
            throw new BadRequestException(
                'This plan involves a database migration. Confirm you have reviewed it by re-submitting with confirmMigration: true.',
            );
        }

        await this.db.feedbackPlan.update({
            where: { id: planId },
            data: { status: 'APPROVED', adminComment: comment ?? null, reviewedAt: new Date(), reviewedBy: adminUserId },
        });
        await this.db.feedback.update({ where: { id: plan.feedbackId }, data: { status: 'PLAN_APPROVED', lastError: null } });
        await this.audit.log('feedback_automation.approve_plan', 'FeedbackPlan', { userId: adminUserId }, planId);

        this.runImplementation(plan.feedbackId, planId).catch((err) => {
            this.logger.error(`Implementation failed for feedback ${plan.feedbackId}: ${err instanceof Error ? err.message : String(err)}`);
        });

        return this.getFeedbackWithPlans(plan.feedbackId);
    }

    /** Direct/manual re-trigger of implementation for a feedback item whose plan is already approved. */
    async implementNow(feedbackId: string, adminUserId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId }, include: { plans: { where: { status: 'APPROVED' }, orderBy: { version: 'desc' }, take: 1 } } });
        if (!feedback) throw new NotFoundException('Feedback not found');
        const plan = feedback.plans[0];
        if (!plan) throw new BadRequestException('No approved plan found for this feedback.');

        await this.db.feedback.update({ where: { id: feedbackId }, data: { status: 'IN_PROGRESS', lastError: null } });
        await this.audit.log('feedback_automation.implement_now', 'Feedback', { userId: adminUserId }, feedbackId);

        this.runImplementation(feedbackId, plan.id).catch((err) => {
            this.logger.error(`Implementation failed for feedback ${feedbackId}: ${err instanceof Error ? err.message : String(err)}`);
        });

        return this.db.feedback.findUniqueOrThrow({ where: { id: feedbackId } });
    }

    private async runImplementation(feedbackId: string, planId: string): Promise<void> {
        await this.db.feedback.update({ where: { id: feedbackId }, data: { status: 'IN_PROGRESS' } });
        const feedback = await this.db.feedback.findUniqueOrThrow({ where: { id: feedbackId } });
        const plan = await this.db.feedbackPlan.findUniqueOrThrow({ where: { id: planId } });

        const branch = `feedback/${feedbackId.slice(0, 8)}`;
        let result: Awaited<ReturnType<FeedbackAgentRunnerService['implementPlan']>> | undefined;
        try {
            result = await this.runner.implementPlan(
                {
                    feedbackType: feedback.type,
                    message: feedback.message,
                    page: feedback.page,
                    adminInstruction: feedback.adminInstruction!,
                    planText: plan.planText,
                },
                branch,
            );

            if (result.filesChanged.length === 0) {
                // The model returned a summary/plan but never applied any edits via write_file, so the
                // working tree is clean. Fail with a clear message instead of an opaque git-commit error.
                throw new Error(
                    'The agent made no file changes, so there is nothing to commit. ' +
                    'This usually means the model described the fix without applying it. ' +
                    'Retry the implementation, or switch to a stronger model in Feedback Automation settings.',
                );
            }

            // Structural sanity gate: catch the corruption mode where the agent truncated a
            // tracked file to nothing (renders as a mass deletion) or created an empty junk file.
            // CI would eventually flag it, but this stops an obviously-broken PR from ever opening.
            const emptyFile = await this.firstEmptyChangedFile(result.workspace.dir, result.filesChanged);
            if (emptyFile) {
                throw new Error(
                    `The agent left "${emptyFile}" empty, which corrupts the file rather than editing it. ` +
                    'Aborted before opening a PR — retry the implementation, or switch to a stronger model in Feedback Automation settings.',
                );
            }

            const migrationFiles = result.filesChanged.filter((f) => f.includes('prisma/migrations/'));
            if (migrationFiles.length > 0) {
                const destructive = await this.anyFileMatches(result.workspace.dir, migrationFiles, DESTRUCTIVE_SQL_PATTERN);
                const requireSignoff = (await this.platformSettings.getRawValue('feedback_automation', 'require_migration_signoff')) !== 'false';
                if (destructive && requireSignoff) {
                    // The plan should have been flagged (and sign-off obtained) at approval time; the model
                    // produced a destructive migration anyway. Abort rather than push a destructive change
                    // that was never explicitly signed off on.
                    throw new Error(
                        `Generated migration(s) [${migrationFiles.join(', ')}] contain a destructive operation ` +
                        `that was not confirmed at plan-approval time. Aborted — review manually and re-approve with confirmMigration.`,
                    );
                }
            }

            await this.github.commitAndPush(result.workspace, branch, `Fix: ${feedback.message.slice(0, 72)}\n\nFeedback #${feedbackId}, plan v${plan.version}`);
            const pr = await this.github.openPullRequest({
                title: `[feedback ${feedbackId.slice(0, 8)}] ${feedback.message.slice(0, 60)}`,
                body: this.buildPrBody(feedback, plan, result.summary),
                head: branch,
                base: result.workspace.baseBranch,
            });

            await this.db.feedback.update({
                where: { id: feedbackId },
                data: { status: 'PR_OPENED', prNumber: pr.number, prUrl: pr.url, lastError: null },
            });
            await this.audit.log('feedback_automation.pr_opened', 'Feedback', {}, feedbackId, { prNumber: pr.number, prUrl: pr.url });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.db.feedback.update({ where: { id: feedbackId }, data: { status: 'PLAN_APPROVED', lastError: message } });
            throw err;
        } finally {
            await result?.workspace.cleanup();
        }
    }

    private buildPrBody(feedback: { id: string; type: string; message: string }, plan: { version: number; planText: string }, summary: string): string {
        return [
            `Automated implementation of tenant feedback **${feedback.id}** (${feedback.type}), plan v${plan.version}, approved by a platform admin.`,
            '',
            '## Agent summary',
            summary,
            '',
            '## Approved plan',
            plan.planText,
            '',
            '_Opened by the ERP71 feedback-automation agent. Do not merge without review — CI must pass first._',
        ].join('\n');
    }

    async refreshPrStatus(feedbackId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId } });
        if (!feedback) throw new NotFoundException('Feedback not found');
        if (!feedback.prNumber) throw new BadRequestException('No pull request has been opened for this feedback yet.');

        const readiness = await this.github.getPrReadiness(feedback.prNumber);
        if (readiness.merged && feedback.status !== 'MERGED' && feedback.status !== 'RESOLVED') {
            const updated = await this.db.feedback.update({
                where: { id: feedbackId },
                data: { status: 'MERGED', mergeCommitSha: readiness.mergeCommitSha },
            });
            // A feedback PR can reach MERGED two ways: the explicit Merge button (mergeFeedbackPr)
            // or being merged on GitHub directly, which this poller detects. Promotion must fire on
            // either — the status guard above makes this run exactly once per feedback.
            this.triggerPromotion();
            return { ...updated, readiness };
        }
        // Surface CI/mergeability alongside the feedback so the panel can gate the Merge button.
        return { ...feedback, readiness };
    }

    async mergeFeedbackPr(feedbackId: string, adminUserId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId } });
        if (!feedback) throw new NotFoundException('Feedback not found');
        if (feedback.status !== 'PR_OPENED') {
            throw new BadRequestException(`Feedback is not awaiting merge (status: ${feedback.status}).`);
        }
        if (!feedback.prNumber) throw new BadRequestException('No pull request has been opened for this feedback yet.');

        // Re-verify the gate server-side — never trust the button's enabled state.
        const readiness = await this.github.getPrReadiness(feedback.prNumber);
        if (readiness.merged) {
            const updated = await this.db.feedback.update({
                where: { id: feedbackId },
                data: { status: 'MERGED', mergeCommitSha: readiness.mergeCommitSha },
            });
            this.triggerPromotion();
            return { ...updated, readiness };
        }
        if (!readiness.green) {
            throw new BadRequestException(
                `PR #${feedback.prNumber} is not ready to merge: ` +
                `${readiness.checks.failed > 0 ? 'CI failed' : readiness.checks.pending > 0 ? 'CI still running' : readiness.checks.total === 0 ? 'no CI checks yet' : readiness.mergeable === false ? 'merge conflict with base branch' : 'not mergeable yet'}.`,
            );
        }

        const result = await this.github.mergePullRequest(feedback.prNumber);
        const updated = await this.db.feedback.update({
            where: { id: feedbackId },
            data: { status: 'MERGED', mergeCommitSha: result.sha ?? readiness.mergeCommitSha },
        });
        await this.audit.log('feedback_automation.pr_merged', 'Feedback', { userId: adminUserId }, feedbackId, { prNumber: feedback.prNumber, mergeCommitSha: result.sha });
        this.triggerPromotion();
        return { ...updated, readiness: { ...readiness, merged: true, mergeCommitSha: result.sha ?? readiness.mergeCommitSha } };
    }

    /** Fire-and-forget kick of the dev→main promotion after a feedback PR lands on dev. Never throws into the caller. */
    private triggerPromotion(): void {
        this.promoteDevToMain().catch((err) => {
            this.logger.error(`dev→main promotion failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    /**
     * Promotes the integration branch (dev) to production (main) once the promotion PR is green.
     * Triggered only by a feedback PR merging to dev — manual/experimental dev commits never trigger it.
     * Idempotent: no-ops when main is already up to date and reuses an already-open promotion PR.
     * Serialized in-process so concurrent feedback merges don't open duplicate promotion PRs.
     */
    async promoteDevToMain(): Promise<{ promoted: boolean; reason?: string; prNumber?: number; mergeCommitSha?: string | null }> {
        if (this.promoting) return { promoted: false, reason: 'a promotion is already in progress' };
        this.promoting = true;
        try {
            const { baseBranch, productionBranch } = await this.github.getBranches();
            const cmp = await this.github.compareBranches(productionBranch, baseBranch);
            if (cmp.aheadBy === 0) {
                return { promoted: false, reason: `${productionBranch} is already up to date with ${baseBranch}` };
            }

            let prNumber = await this.github.findOpenPullRequest(baseBranch, productionBranch);
            if (!prNumber) {
                const pr = await this.github.openPullRequest({
                    title: `Release: promote ${baseBranch} → ${productionBranch}`,
                    body: `Automated promotion of ${cmp.aheadBy} commit(s) from \`${baseBranch}\` to \`${productionBranch}\`, ` +
                        `triggered by a Feedback Automation merge. Merges automatically once CI is green.`,
                    head: baseBranch,
                    base: productionBranch,
                });
                prNumber = pr.number;
            }

            const readiness = await this.waitForPrGreen(prNumber);
            if (readiness.merged) {
                await this.audit.log('feedback_automation.promoted_to_main', 'Feedback', {}, undefined, { prNumber, mergeCommitSha: readiness.mergeCommitSha });
                return { promoted: true, prNumber, mergeCommitSha: readiness.mergeCommitSha };
            }
            if (!readiness.green) {
                const reason = readiness.checks.failed > 0 ? 'promotion PR CI failed' : 'timed out waiting for promotion PR CI to go green';
                this.logger.warn(`dev→main promotion halted (PR #${prNumber}): ${reason}`);
                await this.audit.log('feedback_automation.promotion_halted', 'Feedback', {}, undefined, { prNumber, reason });
                return { promoted: false, reason, prNumber };
            }

            const result = await this.github.mergePullRequest(prNumber);
            await this.audit.log('feedback_automation.promoted_to_main', 'Feedback', {}, undefined, { prNumber, mergeCommitSha: result.sha });
            return { promoted: true, prNumber, mergeCommitSha: result.sha };
        } finally {
            this.promoting = false;
        }
    }

    /** Polls a PR's readiness until it is green, merged, or a check has failed — or the poll budget is exhausted. */
    private async waitForPrGreen(prNumber: number) {
        let readiness = await this.github.getPrReadiness(prNumber);
        for (let i = 0; i < PROMOTE_MAX_POLLS; i++) {
            if (readiness.merged || readiness.green || readiness.checks.failed > 0) return readiness;
            await this.sleep(PROMOTE_POLL_MS);
            readiness = await this.github.getPrReadiness(prNumber);
        }
        return readiness;
    }

    /** Overridable in tests so the poll loop runs instantly. */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async generateRollbackPr(feedbackId: string, adminUserId: string) {
        const feedback = await this.db.feedback.findUnique({ where: { id: feedbackId } });
        if (!feedback) throw new NotFoundException('Feedback not found');
        if (!feedback.mergeCommitSha) {
            throw new BadRequestException('This feedback has no merged commit to roll back yet.');
        }

        const workspace = await this.github.createWorkspace();
        try {
            const branch = `revert/feedback-${feedbackId.slice(0, 8)}-${feedback.mergeCommitSha.slice(0, 7)}`;
            await this.github.revertCommit(workspace, feedback.mergeCommitSha, branch);
            const pr = await this.github.openPullRequest({
                title: `Revert: feedback ${feedbackId.slice(0, 8)} (${feedback.mergeCommitSha.slice(0, 7)})`,
                body: `Reverts commit ${feedback.mergeCommitSha}, originally merged to resolve feedback **${feedbackId}**.\n\nThis PR still requires human review and merge — it is not applied automatically.`,
                head: branch,
                base: workspace.baseBranch,
            });

            const updated = await this.db.feedback.update({
                where: { id: feedbackId },
                data: { status: 'ROLLED_BACK', rollbackPrNumber: pr.number, rollbackPrUrl: pr.url },
            });
            await this.audit.log('feedback_automation.rollback_pr_opened', 'Feedback', { userId: adminUserId }, feedbackId, { prNumber: pr.number, prUrl: pr.url });
            return updated;
        } finally {
            await workspace.cleanup();
        }
    }

    /**
     * Returns the first changed file that now exists but is empty/whitespace-only, or null if
     * none are. A file that reads as `''` was truncated (the corruption we guard against); a file
     * that can't be read (e.g. an intentional deletion) is skipped — only surviving-but-empty files
     * are treated as corruption. Never blocks on a read it can't interpret.
     */
    private async firstEmptyChangedFile(repoDir: string, relativeFiles: string[]): Promise<string | null> {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        for (const file of relativeFiles) {
            let content: unknown;
            try {
                content = await fs.readFile(path.join(repoDir, file), 'utf8');
            } catch {
                // Unreadable (e.g. a genuine deletion) — not our corruption case; skip.
                continue;
            }
            if (typeof content === 'string' && content.trim().length === 0) {
                return file;
            }
        }
        return null;
    }

    private async anyFileMatches(repoDir: string, relativeFiles: string[], pattern: RegExp): Promise<boolean> {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        for (const file of relativeFiles) {
            try {
                const content = await fs.readFile(path.join(repoDir, file), 'utf8');
                if (pattern.test(content)) return true;
            } catch {
                // File may have been deleted by the agent; nothing to scan.
            }
        }
        return false;
    }

    // Runs hourly; only does real work when enabled and due per the configured cadence
    // ('manual' means only the direct admin trigger ever runs plan proposals).
    @Cron('0 * * * *')
    async runScheduledBatch(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.FEEDBACK_PLAN_BATCH, () => this.runScheduledBatchImpl());
    }

    private async runScheduledBatchImpl(): Promise<void> {
        const settings = await this.platformSettings.getRawGroup('feedback_automation');
        if (settings.enabled !== 'true') return;

        const schedule = settings.schedule ?? 'manual';
        if (schedule !== 'daily' && schedule !== 'weekly') return;
        const intervalMs = schedule === 'weekly' ? WEEK_MS : DAY_MS;

        const lastSuccess = await this.db.jobRun.findFirst({
            where: { job_name: JOB_NAMES.FEEDBACK_PLAN_BATCH, status: 'SUCCESS' },
            orderBy: { finished_at: 'desc' },
        });
        if (lastSuccess?.finished_at && Date.now() - lastSuccess.finished_at.getTime() < intervalMs) return;

        const pending = await this.db.feedback.findMany({
            where: { status: 'ADMIN_REVIEWING', adminInstruction: { not: null } },
            take: BATCH_SIZE,
        });

        for (const item of pending) {
            try {
                await this.db.feedback.update({ where: { id: item.id }, data: { status: 'PLAN_REQUESTED' } });
                await this.runPlanRequest(item.id);
            } catch (err) {
                this.logger.error(`Batch plan request failed for feedback ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
}
