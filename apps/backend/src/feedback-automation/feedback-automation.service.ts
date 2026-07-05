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

/** Crude, deliberately conservative static scan — a real destructive change should never slip past a false negative here. */
const DESTRUCTIVE_SQL_PATTERN = /\b(DROP\s+(COLUMN|TABLE)|ALTER\s+COLUMN\s+"?\w+"?\s+(TYPE|SET\s+NOT\s+NULL)|TRUNCATE)\b/i;

@Injectable()
export class FeedbackAutomationService {
    private readonly logger = new Logger(FeedbackAutomationService.name);

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

        const status = await this.github.getPullRequestStatus(feedback.prNumber);
        if (status.merged && feedback.status !== 'MERGED' && feedback.status !== 'RESOLVED') {
            return this.db.feedback.update({
                where: { id: feedbackId },
                data: { status: 'MERGED', mergeCommitSha: status.mergeCommitSha },
            });
        }
        return feedback;
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
