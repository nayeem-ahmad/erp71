import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fsPromises from 'node:fs/promises';
import { FeedbackAutomationService } from './feedback-automation.service';
import { PlanReviewDecision } from './feedback-automation.dto';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));

describe('FeedbackAutomationService', () => {
    let service: FeedbackAutomationService;
    let db: any;
    let platformSettings: any;
    let runner: any;
    let github: any;
    let audit: any;
    let jobTracker: any;

    beforeEach(() => {
        db = {
            feedback: {
                findUnique: jest.fn(),
                findUniqueOrThrow: jest.fn(),
                update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'fb-1', ...data })),
                findMany: jest.fn().mockResolvedValue([]),
            },
            feedbackPlan: {
                findUnique: jest.fn(),
                findUniqueOrThrow: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            jobRun: { findFirst: jest.fn() },
        };
        platformSettings = {
            getRawValue: jest.fn().mockResolvedValue('true'),
            getRawGroup: jest.fn().mockResolvedValue({}),
        };
        runner = { proposePlan: jest.fn(), implementPlan: jest.fn() };
        github = { createWorkspace: jest.fn(), commitAndPush: jest.fn(), openPullRequest: jest.fn(), revertCommit: jest.fn(), getPullRequestStatus: jest.fn() };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        jobTracker = { track: jest.fn((_name: string, fn: () => Promise<unknown>) => fn()) };

        service = new FeedbackAutomationService(db, platformSettings, runner, github, audit, jobTracker);
    });

    describe('saveInstruction', () => {
        it('throws when the feedback does not exist', async () => {
            db.feedback.findUnique.mockResolvedValue(null);
            await expect(service.saveInstruction('missing', 'fix it', 'admin-1')).rejects.toThrow(NotFoundException);
        });

        it('moves NEW feedback to ADMIN_REVIEWING and stores the instruction', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', status: 'NEW' });
            await service.saveInstruction('fb-1', 'Agreed, please fix.', 'admin-1');
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { adminInstruction: 'Agreed, please fix.', status: 'ADMIN_REVIEWING' },
            });
        });

        it('leaves a non-NEW status untouched', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', status: 'PLAN_PROPOSED' });
            await service.saveInstruction('fb-1', 'more context', 'admin-1');
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { adminInstruction: 'more context', status: 'PLAN_PROPOSED' },
            });
        });
    });

    describe('requestPlan', () => {
        it('rejects when no instruction has been saved yet', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', adminInstruction: null });
            await expect(service.requestPlan('fb-1', 'admin-1')).rejects.toThrow(BadRequestException);
        });

        it('sets status to PLAN_REQUESTED and returns immediately without awaiting the agent', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', adminInstruction: 'fix it' });
            db.feedback.findUniqueOrThrow.mockResolvedValue({ id: 'fb-1', adminInstruction: 'fix it', plans: [] });
            runner.proposePlan.mockImplementation(() => new Promise(() => {})); // never resolves in this test

            const result = await service.requestPlan('fb-1', 'admin-1');

            expect(result.status).toBe('PLAN_REQUESTED');
            expect(db.feedback.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'fb-1' }, data: expect.objectContaining({ status: 'PLAN_REQUESTED' }) }),
            );
        });
    });

    describe('runPlanRequest (background plan proposal)', () => {
        it('persists a v1 plan and moves status to PLAN_PROPOSED on success', async () => {
            db.feedback.findUniqueOrThrow.mockResolvedValue({
                id: 'fb-1',
                type: 'bug',
                message: 'discount field resets on edit',
                page: '/dashboard/sales/new',
                adminInstruction: 'confirmed bug, please fix',
                plans: [],
            });
            runner.proposePlan.mockResolvedValue({ planText: 'MIGRATION_REQUIRED: no\n...', hasMigration: false, tokensUsed: 500 });

            await (service as any).runPlanRequest('fb-1');

            expect(db.feedbackPlan.create).toHaveBeenCalledWith({
                data: { feedbackId: 'fb-1', version: 1, planText: expect.stringContaining('MIGRATION_REQUIRED'), hasMigration: false, status: 'PROPOSED' },
            });
            expect(db.feedback.update).toHaveBeenCalledWith({ where: { id: 'fb-1' }, data: { status: 'PLAN_PROPOSED' } });
        });

        it('reverts to ADMIN_REVIEWING with lastError when the agent throws', async () => {
            db.feedback.findUniqueOrThrow.mockResolvedValue({ id: 'fb-1', type: 'bug', message: 'x', page: null, adminInstruction: 'y', plans: [] });
            runner.proposePlan.mockRejectedValue(new Error('OpenRouter timed out'));

            await expect((service as any).runPlanRequest('fb-1')).rejects.toThrow('OpenRouter timed out');
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { status: 'ADMIN_REVIEWING', lastError: 'OpenRouter timed out' },
            });
        });
    });

    describe('reviewPlan', () => {
        it('rejects a plan that is not in PROPOSED state', async () => {
            db.feedbackPlan.findUnique.mockResolvedValue({ id: 'plan-1', status: 'APPROVED', feedbackId: 'fb-1' });
            await expect(
                service.reviewPlan('plan-1', PlanReviewDecision.APPROVE, undefined, undefined, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
        });

        it('requires a comment when requesting changes', async () => {
            db.feedbackPlan.findUnique.mockResolvedValue({ id: 'plan-1', status: 'PROPOSED', feedbackId: 'fb-1' });
            await expect(
                service.reviewPlan('plan-1', PlanReviewDecision.REQUEST_CHANGES, undefined, undefined, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
        });

        it('blocks approval of a migration-touching plan without confirmMigration', async () => {
            db.feedbackPlan.findUnique.mockResolvedValue({ id: 'plan-1', status: 'PROPOSED', feedbackId: 'fb-1', hasMigration: true });
            platformSettings.getRawValue.mockResolvedValue('true'); // require_migration_signoff = true

            await expect(
                service.reviewPlan('plan-1', PlanReviewDecision.APPROVE, undefined, false, 'admin-1'),
            ).rejects.toThrow(BadRequestException);
            expect(db.feedbackPlan.update).not.toHaveBeenCalled();
        });

        it('approves a migration-touching plan once confirmMigration is true', async () => {
            db.feedbackPlan.findUnique.mockResolvedValue({ id: 'plan-1', status: 'PROPOSED', feedbackId: 'fb-1', hasMigration: true });
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', plans: [] });
            platformSettings.getRawValue.mockResolvedValue('true');
            jest.spyOn(service, 'getFeedbackWithPlans').mockResolvedValue({ id: 'fb-1' } as any);

            await service.reviewPlan('plan-1', PlanReviewDecision.APPROVE, undefined, true, 'admin-1');

            expect(db.feedbackPlan.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'plan-1' }, data: expect.objectContaining({ status: 'APPROVED' }) }),
            );
            expect(db.feedback.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'fb-1' }, data: expect.objectContaining({ status: 'PLAN_APPROVED' }) }),
            );
        });
    });

    describe('runImplementation (background implementation)', () => {
        const feedback = { id: 'fb-1', type: 'bug', message: 'x', page: null, adminInstruction: 'fix it' };
        const plan = { id: 'plan-1', version: 1, planText: 'MIGRATION_REQUIRED: no' };
        const workspace = { dir: '/tmp/repo', baseBranch: 'dev', cleanup: jest.fn().mockResolvedValue(undefined) };

        beforeEach(() => {
            db.feedback.findUniqueOrThrow.mockResolvedValue(feedback);
            db.feedbackPlan.findUniqueOrThrow.mockResolvedValue(plan);
        });

        it('opens a PR and sets status PR_OPENED on a clean, non-migration implementation', async () => {
            runner.implementPlan.mockResolvedValue({ summary: 'done', filesChanged: ['apps/backend/src/sales/sales.service.ts'], tokensUsed: 1000, workspace });
            github.commitAndPush.mockResolvedValue(undefined);
            github.openPullRequest.mockResolvedValue({ number: 42, url: 'https://github.com/x/y/pull/42' });

            await (service as any).runImplementation('fb-1', 'plan-1');

            expect(github.commitAndPush).toHaveBeenCalled();
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { status: 'PR_OPENED', prNumber: 42, prUrl: 'https://github.com/x/y/pull/42', lastError: null },
            });
            expect(workspace.cleanup).toHaveBeenCalled();
        });

        it('aborts without opening a PR when a generated migration is destructive', async () => {
            (fsPromises.readFile as jest.Mock).mockResolvedValue('ALTER TABLE "x" DROP COLUMN "y";');
            runner.implementPlan.mockResolvedValue({
                summary: 'done',
                filesChanged: ['packages/database/prisma/migrations/20260101_x/migration.sql'],
                tokensUsed: 1000,
                workspace,
            });
            platformSettings.getRawValue.mockResolvedValue('true'); // require_migration_signoff

            await expect((service as any).runImplementation('fb-1', 'plan-1')).rejects.toThrow(/destructive/i);

            expect(github.commitAndPush).not.toHaveBeenCalled();
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { status: 'PLAN_APPROVED', lastError: expect.stringContaining('destructive') },
            });
            expect(workspace.cleanup).toHaveBeenCalled();
        });
    });

    describe('generateRollbackPr', () => {
        it('rejects when the feedback has no merged commit yet', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', mergeCommitSha: null });
            await expect(service.generateRollbackPr('fb-1', 'admin-1')).rejects.toThrow(BadRequestException);
        });

        it('reverts the commit and opens a rollback PR', async () => {
            db.feedback.findUnique.mockResolvedValue({ id: 'fb-1', mergeCommitSha: 'abc1234567890' });
            const workspace = { dir: '/tmp/repo', baseBranch: 'dev', cleanup: jest.fn().mockResolvedValue(undefined) };
            github.createWorkspace.mockResolvedValue(workspace);
            github.revertCommit.mockResolvedValue(undefined);
            github.openPullRequest.mockResolvedValue({ number: 7, url: 'https://github.com/x/y/pull/7' });

            await service.generateRollbackPr('fb-1', 'admin-1');

            expect(github.revertCommit).toHaveBeenCalledWith(workspace, 'abc1234567890', expect.any(String));
            expect(db.feedback.update).toHaveBeenCalledWith({
                where: { id: 'fb-1' },
                data: { status: 'ROLLED_BACK', rollbackPrNumber: 7, rollbackPrUrl: 'https://github.com/x/y/pull/7' },
            });
            expect(workspace.cleanup).toHaveBeenCalled();
        });
    });
});
