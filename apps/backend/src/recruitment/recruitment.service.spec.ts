import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RecruitmentService } from './recruitment.service';
import { EmployeesService } from '../employees/employees.service';
import { DatabaseService } from '../database/database.service';

const POST = {
    id: 'post-1', tenant_id: 't1', code: 'JOB-00001', title: 'Cashier',
    status: 'OPEN', openings: 1, department_id: null, designation_id: null,
    salary_min: null, salary_max: null, opened_at: new Date(),
};

const APPLICATION = {
    id: 'app-1', tenant_id: 't1', job_post_id: 'post-1', applicant_id: 'cand-1',
    stage: 'OFFER', hired_employee_id: null, deleted_at: null,
    applicant: { id: 'cand-1', name: 'Rina Akter', phone: '01710000000', email: 'rina@example.com' },
    jobPost: POST,
};

describe('RecruitmentService', () => {
    let service: RecruitmentService;
    let db: any;
    let employees: any;

    beforeEach(async () => {
        db = {
            jobPost: {
                findFirst: jest.fn().mockResolvedValue(POST),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'post-new', ...data })),
                update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'post-1', ...data })),
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _sum: { openings: 0 } }),
            },
            applicant: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cand-new', ...data })),
                update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cand-1', ...data })),
            },
            jobApplication: {
                findFirst: jest.fn().mockResolvedValue(APPLICATION),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'app-new', ...data })),
                update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'app-1', ...data })),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            jobApplicationEvent: {
                create: jest.fn().mockResolvedValue({}),
                findMany: jest.fn().mockResolvedValue([]),
            },
            department: { findFirst: jest.fn().mockResolvedValue({ id: 'dept-1' }) },
            designation: { findFirst: jest.fn().mockResolvedValue({ id: 'desig-1' }) },
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
        };
        employees = {
            create: jest.fn().mockResolvedValue({ id: 'emp-new', employee_code: 'EMP-00007', name: 'Rina Akter' }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RecruitmentService,
                { provide: DatabaseService, useValue: db },
                { provide: EmployeesService, useValue: employees },
            ],
        }).compile();
        service = module.get(RecruitmentService);
    });

    describe('job posts', () => {
        it('numbers the first post JOB-00001 and the next one after the highest code', async () => {
            db.jobPost.findFirst.mockResolvedValueOnce(null);
            const first = await service.createJobPost('t1', { title: 'Cashier' });
            expect(first.code).toBe('JOB-00001');

            db.jobPost.findFirst.mockResolvedValueOnce({ code: 'JOB-00042' });
            const next = await service.createJobPost('t1', { title: 'Driver' });
            expect(next.code).toBe('JOB-00043');
        });

        it('dates a post that opens immediately and leaves a draft undated', async () => {
            db.jobPost.findFirst.mockResolvedValue(null);
            const open = await service.createJobPost('t1', { title: 'Cashier', status: 'OPEN' });
            expect(open.opened_at).toBeInstanceOf(Date);

            const draft = await service.createJobPost('t1', { title: 'Cashier' });
            expect(draft.opened_at).toBeNull();
        });

        it('leaves a new post off the public careers board unless asked', async () => {
            db.jobPost.findFirst.mockResolvedValue(null);

            // OPEN alone must not publish: it meant "we are hiring" long before a
            // public board existed, so advertising is a separate, explicit choice.
            const open = await service.createJobPost('t1', { title: 'Cashier', status: 'OPEN' });
            expect(open.publish_to_board).toBe(false);

            const listed = await service.createJobPost('t1', {
                title: 'Cashier', status: 'OPEN', publish_to_board: true,
            });
            expect(listed.publish_to_board).toBe(true);
        });

        it('can take a post off the board without closing it', async () => {
            db.jobPost.findFirst.mockResolvedValue({ ...POST, publish_to_board: true });

            await service.updateJobPost('t1', 'post-1', {
                title: 'Cashier', publish_to_board: false,
            });

            const patch = db.jobPost.update.mock.calls[0][0].data;
            expect(patch.publish_to_board).toBe(false);
            expect(patch.status).toBeUndefined();
        });

        it('keeps the original opening date when a paused post reopens', async () => {
            const openedAt = new Date('2026-01-05T00:00:00Z');
            db.jobPost.findFirst.mockResolvedValue({ ...POST, status: 'ON_HOLD', opened_at: openedAt });

            await service.updateJobPost('t1', 'post-1', { title: 'Cashier', status: 'OPEN' });

            expect(db.jobPost.update.mock.calls[0][0].data.opened_at).toBeUndefined();
        });

        it('rejects a salary band that runs backwards', async () => {
            await expect(service.createJobPost('t1', { title: 'Cashier', salary_min: 30000, salary_max: 20000 }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses to delete a post that still has live candidates', async () => {
            db.jobApplication.count.mockResolvedValue(3);
            await expect(service.deleteJobPost('t1', 'post-1')).rejects.toThrow(BadRequestException);
            expect(db.jobPost.update).not.toHaveBeenCalled();
        });

        it('counts applications per post in one grouped query, not one per post', async () => {
            db.jobPost.findMany.mockResolvedValue([{ id: 'post-1' }, { id: 'post-2' }]);
            db.jobApplication.groupBy.mockResolvedValue([
                { job_post_id: 'post-1', stage: 'APPLIED', _count: { _all: 4 } },
                { job_post_id: 'post-1', stage: 'HIRED', _count: { _all: 1 } },
                { job_post_id: 'post-1', stage: 'REJECTED', _count: { _all: 2 } },
            ]);

            const posts = await service.listJobPosts('t1');

            expect(db.jobApplication.groupBy).toHaveBeenCalledTimes(1);
            expect(posts[0]).toMatchObject({ application_count: 7, open_application_count: 4, hired_count: 1 });
            expect(posts[1]).toMatchObject({ application_count: 0, open_application_count: 0 });
        });
    });

    describe('applicants', () => {
        it('restores a soft-deleted applicant rather than failing on the phone number', async () => {
            // The unique index spans deleted rows, so a returning candidate would
            // otherwise collide with something the tenant cannot see.
            db.applicant.findFirst.mockResolvedValue({ id: 'cand-1', deleted_at: new Date() });

            await service.createApplicant('t1', { name: 'Rina Akter', phone: '01710000000' });

            expect(db.applicant.create).not.toHaveBeenCalled();
            expect(db.applicant.update.mock.calls[0][0].data.deleted_at).toBeNull();
        });

        it('rejects a duplicate phone number on a live applicant', async () => {
            db.applicant.findFirst.mockResolvedValue({ id: 'cand-1', deleted_at: null });
            await expect(service.createApplicant('t1', { name: 'Rina', phone: '01710000000' }))
                .rejects.toThrow(ConflictException);
        });

        it('refuses to delete an applicant who is still in a pipeline', async () => {
            db.applicant.findFirst.mockResolvedValue({ id: 'cand-1', deleted_at: null });
            db.jobApplication.count.mockResolvedValue(1);
            await expect(service.deleteApplicant('t1', 'cand-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('applications', () => {
        it('reuses an existing candidate when a new application repeats their phone number', async () => {
            db.applicant.findFirst.mockResolvedValue({ id: 'cand-1', deleted_at: null });
            db.jobApplication.findFirst
                .mockResolvedValueOnce(null)          // duplicate check
                .mockResolvedValueOnce(APPLICATION);  // getApplication reload

            await service.createApplication('t1', {
                job_post_id: 'post-1',
                applicant: { name: 'Rina Akter', phone: '01710000000' },
            });

            expect(db.applicant.create).not.toHaveBeenCalled();
            expect(db.jobApplication.create.mock.calls[0][0].data.applicant_id).toBe('cand-1');
        });

        it('rejects a second application to the same post', async () => {
            db.applicant.findFirst.mockResolvedValue({ id: 'cand-1', deleted_at: null });
            db.jobApplication.findFirst.mockResolvedValue({ id: 'app-1', deleted_at: null });

            await expect(service.createApplication('t1', { job_post_id: 'post-1', applicant_id: 'cand-1' }))
                .rejects.toThrow(ConflictException);
        });

        it('refuses applications to a closed post', async () => {
            db.jobPost.findFirst.mockResolvedValue({ ...POST, status: 'CLOSED' });
            await expect(service.createApplication('t1', { job_post_id: 'post-1', applicant_id: 'cand-1' }))
                .rejects.toThrow(BadRequestException);
        });

        it('logs every stage move against the application', async () => {
            db.jobApplication.findFirst
                .mockResolvedValueOnce({ ...APPLICATION, stage: 'APPLIED' })
                .mockResolvedValueOnce(APPLICATION);

            await service.changeStage('t1', 'app-1', { stage: 'INTERVIEW' }, 'user-1');

            expect(db.jobApplicationEvent.create.mock.calls[0][0].data).toMatchObject({
                application_id: 'app-1', from_stage: 'APPLIED', to_stage: 'INTERVIEW',
                created_by_user_id: 'user-1',
            });
        });

        it('clears a rejection reason when the candidate comes back into the pipeline', async () => {
            db.jobApplication.findFirst
                .mockResolvedValueOnce({ ...APPLICATION, stage: 'REJECTED', rejection_reason: 'Salary mismatch' })
                .mockResolvedValueOnce(APPLICATION);

            await service.changeStage('t1', 'app-1', { stage: 'INTERVIEW' });

            expect(db.jobApplication.update.mock.calls[0][0].data.rejection_reason).toBeNull();
        });

        it('sends HIRED through the hire action instead of a bare stage change', async () => {
            await expect(service.changeStage('t1', 'app-1', { stage: 'HIRED' }))
                .rejects.toThrow(BadRequestException);
            expect(db.jobApplication.update).not.toHaveBeenCalled();
        });

        it('will not move a candidate who has already been hired', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION, stage: 'HIRED' });
            await expect(service.changeStage('t1', 'app-1', { stage: 'OFFER' }))
                .rejects.toThrow(BadRequestException);
        });

        it('404s on an application from another tenant', async () => {
            db.jobApplication.findFirst.mockResolvedValue(null);
            await expect(service.getApplication('t1', 'app-1')).rejects.toThrow(NotFoundException);
        });
    });

    describe('hire', () => {
        it('creates the employee, links it to the application, and logs the hire', async () => {
            db.jobApplication.findFirst
                .mockResolvedValueOnce(APPLICATION)
                .mockResolvedValueOnce({ ...APPLICATION, stage: 'HIRED', hired_employee_id: 'emp-new' });

            await service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' }, {
                tenantId: 't1', userId: 'user-1',
            });

            expect(employees.create.mock.calls[0][1]).toMatchObject({
                name: 'Rina Akter', phone: '01710000000', date_of_joining: '2026-09-01',
            });
            expect(db.jobApplication.update.mock.calls[0][0].data).toMatchObject({
                stage: 'HIRED', hired_employee_id: 'emp-new',
            });
            expect(db.jobApplicationEvent.create.mock.calls[0][0].data.to_stage).toBe('HIRED');
        });

        it('marks the post filled only once the hires reach its headcount', async () => {
            db.jobPost.findFirst.mockResolvedValue(POST);
            db.jobApplication.findFirst
                .mockResolvedValueOnce({ ...APPLICATION, jobPost: { ...POST, openings: 3 } })
                .mockResolvedValueOnce(APPLICATION);
            db.jobApplication.count.mockResolvedValue(1);

            await service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' });

            expect(db.jobPost.update).not.toHaveBeenCalled();

            db.jobApplication.findFirst
                .mockResolvedValueOnce({ ...APPLICATION, jobPost: { ...POST, openings: 3 } })
                .mockResolvedValueOnce(APPLICATION);
            db.jobApplication.count.mockResolvedValue(3);

            await service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' });

            expect(db.jobPost.update.mock.calls[0][0].data.status).toBe('FILLED');
        });

        it('falls back to the post\'s department and designation when the hire form leaves them blank', async () => {
            db.jobApplication.findFirst
                .mockResolvedValueOnce({
                    ...APPLICATION,
                    jobPost: { ...POST, department_id: 'dept-9', designation_id: 'desig-9' },
                })
                .mockResolvedValueOnce(APPLICATION);

            await service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' });

            expect(employees.create.mock.calls[0][1]).toMatchObject({
                department_id: 'dept-9', designation_id: 'desig-9',
            });
        });

        it('refuses to hire the same candidate twice', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION, hired_employee_id: 'emp-3' });
            await expect(service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' }))
                .rejects.toThrow(BadRequestException);
            expect(employees.create).not.toHaveBeenCalled();
        });

        it('refuses to hire out of a rejected application', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION, stage: 'REJECTED' });
            await expect(service.hire('t1', 'app-1', { date_of_joining: '2026-09-01' }))
                .rejects.toThrow(BadRequestException);
        });

        it('keeps a hired application as the record of how that employee joined', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION, hired_employee_id: 'emp-3' });
            await expect(service.deleteApplication('t1', 'app-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('summary', () => {
        it('counts only the live stages as the pipeline', async () => {
            db.jobPost.count.mockResolvedValue(2);
            db.jobPost.aggregate.mockResolvedValue({ _sum: { openings: 5 } });
            db.jobApplication.groupBy.mockResolvedValue([
                { stage: 'APPLIED', _count: { _all: 6 } },
                { stage: 'INTERVIEW', _count: { _all: 2 } },
                { stage: 'HIRED', _count: { _all: 3 } },
                { stage: 'REJECTED', _count: { _all: 9 } },
            ]);
            db.jobApplication.count.mockResolvedValue(1);

            const summary = await service.summary('t1');

            expect(summary).toMatchObject({
                open_posts: 2, open_openings: 5, in_pipeline: 8, hired_this_month: 1,
            });
            expect(summary.stage_counts.REJECTED).toBe(9);
        });
    });
});
