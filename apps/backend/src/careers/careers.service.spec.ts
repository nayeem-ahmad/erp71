import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { CareersApplicationStage } from '@erp71/shared-types';
import { CareersService } from './careers.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { AUTH_SCOPE_APPLICANT } from '../auth/token-scope';

/**
 * The careers module is the applicant's view of rows the hiring workspace owns,
 * so the rules it replaces tenant scoping with are what this file pins:
 *
 *  - every portal read is filtered through `Applicant.user_id` in the `where`
 *    rather than checked afterwards, so a foreign id is a 404 and not a leak;
 *  - the workspace's private columns are never selected;
 *  - `apply()` copies `tenant_id` off the post instead of accepting one, and
 *    only claims an existing candidate record on a *verified* identifier.
 */
describe('CareersService', () => {
    let service: CareersService;
    let db: any;

    const SEEKER_ID = 'seeker-1';
    const USER_ID = 'user-1';

    const POST_ROW = {
        id: 'post-1',
        code: 'JOB-00001',
        title: 'Senior Accountant',
        location: 'Dhaka',
        employment_type: 'FULL_TIME',
        salary_min: '40000',
        salary_max: '60000',
        openings: 2,
        opened_at: new Date('2026-08-01'),
        closing_date: null,
        department: { name: 'Finance' },
        tenant: { id: 'tenant-1', name: 'Rahim Stores', brand_business_name: null },
    };

    const APPLICATION_ROW = {
        id: 'application-1',
        stage: CareersApplicationStage.APPLIED,
        applied_at: new Date('2026-08-05'),
        stage_changed_at: new Date('2026-08-05'),
        expected_salary: '50000',
        cover_letter: 'Please consider me.',
        jobPost: {
            id: 'post-1',
            code: 'JOB-00001',
            title: 'Senior Accountant',
            location: 'Dhaka',
            employment_type: 'FULL_TIME',
            status: 'OPEN',
            publish_to_board: true,
            deleted_at: null,
        },
        applicant: { resume_url: 'https://cdn.example/cv.pdf' },
        tenant: { id: 'tenant-1', name: 'Rahim Stores', brand_business_name: null },
    };

    /** An unverified job seeker with a CV and a phone — the ordinary case. */
    const seekerRow = (overrides: any = {}) => ({
        id: SEEKER_ID,
        user_id: USER_ID,
        full_name: 'Karim Ahmed',
        phone: '01700000000',
        headline: 'Accountant, 6 years',
        location: 'Dhaka',
        resume_url: 'https://cdn.example/cv.pdf',
        resume_name: 'cv.pdf',
        user: {
            id: USER_ID,
            email: 'karim@example.com',
            mobile: null,
            email_verified_at: null,
            mobile_verified_at: null,
        },
        ...overrides,
    });

    beforeEach(async () => {
        db = {
            jobPost: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            jobApplication: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
                update: jest.fn(),
            },
            jobApplicationEvent: { create: jest.fn() },
            applicant: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
            jobSeeker: {
                findFirst: jest.fn().mockResolvedValue({ user_id: USER_ID }),
                findUnique: jest.fn(),
                update: jest.fn(),
                upsert: jest.fn(),
            },
            tenant: { findMany: jest.fn().mockResolvedValue([]) },
            user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
            $transaction: jest.fn(async (fn: any) => fn(db)),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                CareersService,
                { provide: DatabaseService, useValue: db },
                { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed-token') } },
                {
                    provide: TotpService,
                    useValue: { isEnabled: jest.fn().mockReturnValue(false), verifyTotpForLogin: jest.fn() },
                },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
            ],
        }).compile();

        service = moduleRef.get(CareersService);
    });

    describe('the public board', () => {
        it('lists only OPEN posts that were explicitly published to the board', async () => {
            await service.listJobs({});

            const { where } = db.jobPost.findMany.mock.calls[0][0];
            expect(where.status).toBe('OPEN');
            // The whole point of the separate flag: OPEN alone is not enough.
            expect(where.publish_to_board).toBe(true);
            expect(where.deleted_at).toBeNull();
            expect(where.tenant).toEqual({ deleted_at: null });
        });

        it('drops a post whose closing date has passed, without anyone closing it', async () => {
            await service.listJobs({});

            const { where } = db.jobPost.findMany.mock.calls[0][0];
            expect(where.OR).toEqual([
                { closing_date: null },
                { closing_date: { gte: expect.any(Date) } },
            ]);
        });

        it('keeps the closing-date filter when a search term is supplied', async () => {
            await service.listJobs({ search: 'accountant' });

            const { where } = db.jobPost.findMany.mock.calls[0][0];
            // The search must not land as a sibling `OR`, which would replace the
            // listed-post one and resurface expired vacancies.
            expect(where.OR).toEqual([
                { closing_date: null },
                { closing_date: { gte: expect.any(Date) } },
            ]);
            expect(where.AND[0].OR).toHaveLength(2);
        });

        it('marks jobs the signed-in seeker has already applied to', async () => {
            db.jobPost.findMany.mockResolvedValue([POST_ROW]);
            db.jobPost.count.mockResolvedValue(1);
            db.jobApplication.findMany.mockResolvedValue([{ job_post_id: 'post-1' }]);

            const result = await service.listJobs({}, SEEKER_ID);

            expect(result.items[0].already_applied).toBe(true);
            const { where } = db.jobApplication.findMany.mock.calls[0][0];
            // Reached through the candidate record, not a direct column.
            expect(where.applicant).toEqual({ is: { user_id: USER_ID } });
            // A withdrawn application must not block re-applying.
            expect(where.stage).toEqual({ not: CareersApplicationStage.WITHDRAWN });
        });

        it('treats an anonymous visitor as having applied to nothing', async () => {
            db.jobPost.findMany.mockResolvedValue([POST_ROW]);
            db.jobPost.count.mockResolvedValue(1);

            const result = await service.listJobs({});

            expect(result.items[0].already_applied).toBe(false);
            expect(db.jobApplication.findMany).not.toHaveBeenCalled();
        });
    });

    describe('reading my own applications', () => {
        it('filters through Applicant.user_id rather than checking after the read', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION_ROW, events: [] });

            await service.getMyApplication(SEEKER_ID, 'application-1');

            expect(db.jobApplication.findFirst.mock.calls[0][0].where).toEqual({
                id: 'application-1',
                deleted_at: null,
                applicant: { is: { user_id: USER_ID } },
            });
        });

        it('404s on another candidate’s application instead of returning it', async () => {
            db.jobApplication.findFirst.mockResolvedValue(null);

            await expect(service.getMyApplication(SEEKER_ID, 'someone-elses')).rejects.toThrow(
                NotFoundException,
            );
        });

        it('never selects the workspace’s private columns', async () => {
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION_ROW, events: [] });

            await service.getMyApplication(SEEKER_ID, 'application-1');

            const { select } = db.jobApplication.findFirst.mock.calls[0][0];
            for (const field of ['notes', 'rating', 'rejection_reason', 'source', 'hired_employee_id']) {
                expect(select[field]).toBeUndefined();
            }
            // The event note is where interviewers write internal remarks.
            expect(select.events.select.note).toBeUndefined();
        });
    });

    describe('applying', () => {
        beforeEach(() => {
            db.jobPost.findFirst.mockResolvedValue({
                id: 'post-1',
                tenant_id: 'tenant-1',
                title: 'Senior Accountant',
            });
            db.jobSeeker.findFirst.mockImplementation(({ select }: any) =>
                select?.user_id ? { user_id: USER_ID } : seekerRow(),
            );
            db.applicant.create.mockResolvedValue({ id: 'applicant-1' });
            db.jobApplication.create.mockResolvedValue({ id: 'application-1' });
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION_ROW, events: [] });
        });

        it('copies tenant_id off the post rather than trusting the caller', async () => {
            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.jobApplication.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                job_post_id: 'post-1',
                applicant_id: 'applicant-1',
                stage: CareersApplicationStage.APPLIED,
                source: 'Careers board',
            });
        });

        it('creates the tenant’s candidate record so it shows on their existing screens', async () => {
            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.applicant.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                user_id: USER_ID,
                phone: '01700000000',
                name: 'Karim Ahmed',
            });
        });

        it('refuses a post that is not listed, with the same predicate as the board', async () => {
            db.jobPost.findFirst.mockResolvedValue(null);

            await expect(service.apply(SEEKER_ID, 'post-1', {})).rejects.toThrow(NotFoundException);
            expect(db.jobApplication.create).not.toHaveBeenCalled();
        });

        it('refuses when the profile has no CV', async () => {
            db.jobSeeker.findFirst.mockImplementation(({ select }: any) =>
                select?.user_id ? { user_id: USER_ID } : seekerRow({ resume_url: null }),
            );

            await expect(service.apply(SEEKER_ID, 'post-1', {})).rejects.toThrow(BadRequestException);
        });

        it('refuses when the profile has no mobile number', async () => {
            db.jobSeeker.findFirst.mockImplementation(({ select }: any) =>
                select?.user_id ? { user_id: USER_ID } : seekerRow({ phone: null }),
            );

            await expect(service.apply(SEEKER_ID, 'post-1', {})).rejects.toThrow(
                'Add your mobile number to your profile before applying',
            );
        });

        it('rejects a second application to the same post', async () => {
            db.jobApplication.findUnique.mockResolvedValue({
                id: 'application-1',
                stage: CareersApplicationStage.SCREENING,
                deleted_at: null,
            });

            await expect(service.apply(SEEKER_ID, 'post-1', {})).rejects.toThrow(ConflictException);
        });

        it('reuses the existing row when re-applying after withdrawing', async () => {
            db.jobApplication.findUnique.mockResolvedValue({
                id: 'application-1',
                stage: CareersApplicationStage.WITHDRAWN,
                deleted_at: null,
            });
            db.jobApplication.update.mockResolvedValue({ id: 'application-1' });

            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.jobApplication.create).not.toHaveBeenCalled();
            expect(db.jobApplication.update.mock.calls[0][0].data).toMatchObject({
                stage: CareersApplicationStage.APPLIED,
            });
        });
    });

    /**
     * The delicate part. `Applicant` is unique on `[tenant_id, phone]`, so a
     * collision forces the row to be reused — and reusing it on an unverified
     * match would hand somebody another person's interview history.
     */
    describe('claiming a candidate record a company already holds', () => {
        beforeEach(() => {
            db.jobPost.findFirst.mockResolvedValue({
                id: 'post-1',
                tenant_id: 'tenant-1',
                title: 'Senior Accountant',
            });
            db.jobApplication.create.mockResolvedValue({ id: 'application-1' });
            db.jobApplication.findFirst.mockResolvedValue({ ...APPLICATION_ROW, events: [] });
        });

        const withSeeker = (overrides: any) =>
            db.jobSeeker.findFirst.mockImplementation(({ select }: any) =>
                select?.user_id ? { user_id: USER_ID } : seekerRow(overrides),
            );

        it('refuses rather than claiming when nothing is verified', async () => {
            withSeeker({});
            // No linked record, no verified match, but the phone is taken.
            db.applicant.findFirst
                .mockResolvedValueOnce(null) // already linked?
                .mockResolvedValueOnce({ id: 'someone-else' }); // phone taken

            await expect(service.apply(SEEKER_ID, 'post-1', {})).rejects.toThrow(
                /already has a candidate record with your mobile number/,
            );
            expect(db.applicant.create).not.toHaveBeenCalled();
            expect(db.applicant.update).not.toHaveBeenCalled();
        });

        it('claims an unclaimed record on a verified mobile', async () => {
            withSeeker({
                user: {
                    id: USER_ID,
                    email: 'karim@example.com',
                    mobile: '01700000000',
                    email_verified_at: null,
                    mobile_verified_at: new Date(),
                },
            });
            db.applicant.findFirst
                .mockResolvedValueOnce(null) // already linked?
                .mockResolvedValueOnce({ id: 'existing-applicant' }); // claimable
            db.applicant.update.mockResolvedValue({ id: 'existing-applicant' });

            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.applicant.update.mock.calls[0][0].data).toMatchObject({ user_id: USER_ID });
            // Only unclaimed rows are offered up.
            expect(db.applicant.findFirst.mock.calls[1][0].where.user_id).toBeNull();
        });

        it('claims on a verified email too', async () => {
            withSeeker({
                user: {
                    id: USER_ID,
                    email: 'karim@example.com',
                    mobile: null,
                    email_verified_at: new Date(),
                    mobile_verified_at: null,
                },
            });
            db.applicant.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'existing-applicant' });
            db.applicant.update.mockResolvedValue({ id: 'existing-applicant' });

            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.applicant.findFirst.mock.calls[1][0].where.OR).toContainEqual({
                email: { equals: 'karim@example.com', mode: 'insensitive' },
            });
        });

        it('reuses the already-linked record on a second application to the same company', async () => {
            withSeeker({});
            db.applicant.findFirst.mockResolvedValueOnce({ id: 'applicant-1' });
            db.applicant.update.mockResolvedValue({ id: 'applicant-1' });

            await service.apply(SEEKER_ID, 'post-1', {});

            expect(db.applicant.create).not.toHaveBeenCalled();
            // Refreshed, but the workspace's own columns are left alone.
            const patch = db.applicant.update.mock.calls[0][0].data;
            expect(patch).toMatchObject({ name: 'Karim Ahmed' });
            for (const field of ['notes', 'rating', 'source', 'phone']) {
                expect(patch[field]).toBeUndefined();
            }
        });
    });

    describe('withdrawing', () => {
        it('is refused once the company has decided', async () => {
            db.jobApplication.findFirst.mockResolvedValue({
                id: 'application-1',
                stage: CareersApplicationStage.HIRED,
                tenant_id: 'tenant-1',
            });

            await expect(service.withdraw(SEEKER_ID, 'application-1')).rejects.toThrow(
                BadRequestException,
            );
        });

        it('writes a timeline entry alongside the stage change', async () => {
            db.jobApplication.findFirst
                .mockResolvedValueOnce({
                    id: 'application-1',
                    stage: CareersApplicationStage.INTERVIEW,
                    tenant_id: 'tenant-1',
                })
                .mockResolvedValue({ ...APPLICATION_ROW, events: [] });

            await service.withdraw(SEEKER_ID, 'application-1');

            expect(db.jobApplicationEvent.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                application_id: 'application-1',
                from_stage: CareersApplicationStage.INTERVIEW,
                to_stage: CareersApplicationStage.WITHDRAWN,
            });
        });

        it('404s rather than touching an application belonging to someone else', async () => {
            db.jobApplication.findFirst.mockResolvedValue(null);

            await expect(service.withdraw(SEEKER_ID, 'application-1')).rejects.toThrow(
                NotFoundException,
            );
            expect(db.jobApplication.update).not.toHaveBeenCalled();
        });
    });

    describe('sessions', () => {
        it('mints an applicant-scoped token carrying atv, never tv', async () => {
            db.user.findUnique.mockResolvedValue({
                id: USER_ID,
                email: 'karim@example.com',
                passwordHash: await require('bcrypt').hash('password123', 4),
                applicant_token_version: 3,
                totp_secret: null,
            });
            db.jobSeeker.findFirst.mockResolvedValue({ id: SEEKER_ID, full_name: 'Karim' });

            const jwt = (service as any).jwt as { sign: jest.Mock };
            await service.login({ email: 'karim@example.com', password: 'password123' });

            expect(jwt.sign).toHaveBeenCalledWith(
                expect.objectContaining({ scope: AUTH_SCOPE_APPLICANT, atv: 3 }),
            );
            expect(jwt.sign.mock.calls[0][0].tv).toBeUndefined();
        });

        it('refuses a login for an account with no careers profile', async () => {
            db.user.findUnique.mockResolvedValue({
                id: USER_ID,
                email: 'owner@example.com',
                passwordHash: await require('bcrypt').hash('password123', 4),
                totp_secret: null,
            });
            db.jobSeeker.findFirst.mockResolvedValue(null);

            await expect(
                service.login({ email: 'owner@example.com', password: 'password123' }),
            ).rejects.toThrow('No careers profile found for this account. Please sign up first.');
        });

        it('revokes only careers sessions on logout', async () => {
            await service.logout(USER_ID);

            expect(db.user.update).toHaveBeenCalledWith({
                where: { id: USER_ID },
                data: { applicant_token_version: { increment: 1 } },
            });
        });
    });
});
