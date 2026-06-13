import { JobTrackerService } from './job-tracker.service';
import { JOB_NAMES, JOB_REGISTRY } from './job-names';

describe('JobTrackerService', () => {
    let db: any;
    let service: JobTrackerService;

    beforeEach(() => {
        db = {
            jobRun: {
                create: jest.fn().mockResolvedValue({ id: 'run-1' }),
                update: jest.fn().mockResolvedValue({}),
                findFirst: jest.fn(),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        service = new JobTrackerService(db);
    });

    describe('track', () => {
        it('records a SUCCESS run and returns the job result', async () => {
            const result = await service.track(JOB_NAMES.BILLING_DUNNING, async () => 42);

            expect(result).toBe(42);
            expect(db.jobRun.create).toHaveBeenCalledWith({
                data: { job_name: JOB_NAMES.BILLING_DUNNING, status: 'RUNNING' },
            });
            expect(db.jobRun.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'run-1' },
                    data: expect.objectContaining({ status: 'SUCCESS' }),
                }),
            );
        });

        it('records a FAILED run and re-throws the error', async () => {
            const boom = new Error('kaboom');

            await expect(
                service.track(JOB_NAMES.CRM_CAMPAIGNS, async () => {
                    throw boom;
                }),
            ).rejects.toThrow('kaboom');

            expect(db.jobRun.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'FAILED', error: 'kaboom' }),
                }),
            );
        });

        it('still runs the job if the start record cannot be written', async () => {
            db.jobRun.create.mockRejectedValue(new Error('db down'));

            const result = await service.track(JOB_NAMES.BILLING_RETRY, async () => 'ok');

            expect(result).toBe('ok');
            // No id to update, so completion write is skipped — never throws.
            expect(db.jobRun.update).not.toHaveBeenCalled();
        });
    });

    describe('getJobStatuses', () => {
        it('returns one status per registered job', async () => {
            db.jobRun.findFirst.mockResolvedValue(null);

            const statuses = await service.getJobStatuses();

            expect(statuses).toHaveLength(JOB_REGISTRY.length);
            expect(statuses.every((s) => s.overdue === false)).toBe(true);
        });

        it('flags a job overdue when its last success is older than the threshold', async () => {
            const ancient = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
            db.jobRun.findFirst.mockImplementation(({ where }: any) => {
                const record = {
                    started_at: ancient,
                    finished_at: ancient,
                    status: 'SUCCESS',
                    duration_ms: 10,
                    error: null,
                };
                return Promise.resolve(record);
            });

            const statuses = await service.getJobStatuses();

            expect(statuses.every((s) => s.overdue)).toBe(true);
        });

        it('does not flag overdue when there is no recorded success', async () => {
            db.jobRun.findFirst.mockImplementation(({ where }: any) =>
                Promise.resolve(
                    where.status === 'SUCCESS'
                        ? null
                        : { started_at: new Date(), status: 'FAILED', duration_ms: 5, error: 'x', finished_at: new Date() },
                ),
            );

            const statuses = await service.getJobStatuses();

            expect(statuses.every((s) => s.overdue === false)).toBe(true);
            expect(statuses.every((s) => s.last_status === 'FAILED')).toBe(true);
        });
    });

    describe('purgeOlderThan', () => {
        it('deletes rows older than the cutoff and returns the count', async () => {
            db.jobRun.deleteMany.mockResolvedValue({ count: 7 });

            const removed = await service.purgeOlderThan(30);

            expect(removed).toBe(7);
            expect(db.jobRun.deleteMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { started_at: { lt: expect.any(Date) } } }),
            );
        });
    });
});
