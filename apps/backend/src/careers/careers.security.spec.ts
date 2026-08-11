import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CareersPortalController, CareersPublicController } from './careers.controller';
import { CareersService } from './careers.service';
import { CareersJwtGuard, JobSeekerGuard } from './job-seeker.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';
import {
    AUTH_SCOPE_APP,
    AUTH_SCOPE_APPLICANT,
    AUTH_SCOPE_STOREFRONT,
} from '../auth/token-scope';

/**
 * The careers portal is the first surface whose users hold **no** `TenantUser`
 * row anywhere on the platform. That makes the token scope, not permissions,
 * the boundary that matters — and it has to hold in both directions:
 *
 *  - an applicant token must not reach the ERP API (`JwtAuthGuard`), and
 *  - an ERP or storefront token must not reach the portal (`CareersJwtGuard`),
 *    or a workspace owner's ordinary session would silently act as whatever
 *    applicant profile the same `User` happens to own.
 *
 * Both guards are unit-tested directly here rather than through HTTP, because
 * what they wrap — passport's `AuthGuard('jwt')` — is what an end-to-end test
 * would have to stub out anyway.
 */
describe('Careers portal — security', () => {
    describe('JwtAuthGuard rejects everything that is not an app token', () => {
        // `super.handleRequest` is passport's; stub it so the scope check is
        // what the assertion is actually about.
        function runAppGuard(user: any) {
            const guard = new JwtAuthGuard();
            jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'handleRequest',
            ).mockReturnValue(user);
            return () => guard.handleRequest(null, user, null, null);
        }

        const NOT_FOR_APP = 'This session is not valid for the application API';

        it('lets an ordinary app token through', () => {
            expect(runAppGuard({ userId: 'u1', scope: AUTH_SCOPE_APP })()).toMatchObject({
                userId: 'u1',
            });
        });

        it('lets a pre-scope legacy token through', () => {
            expect(runAppGuard({ userId: 'u1' })()).toMatchObject({ userId: 'u1' });
        });

        it('refuses an applicant token', () => {
            expect(runAppGuard({ userId: 'u1', scope: AUTH_SCOPE_APPLICANT })).toThrow(NOT_FOR_APP);
        });

        it('still refuses a storefront token', () => {
            expect(runAppGuard({ userId: 'u1', scope: AUTH_SCOPE_STOREFRONT })).toThrow(NOT_FOR_APP);
        });
    });

    describe('CareersJwtGuard rejects everything that is not an applicant token', () => {
        function handle(user: any) {
            const guard = new CareersJwtGuard();
            jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(guard)),
                'handleRequest',
            ).mockReturnValue(user);
            return () => guard.handleRequest(null, user, null, null);
        }

        it('lets an applicant token through', () => {
            expect(handle({ userId: 'u1', scope: AUTH_SCOPE_APPLICANT })()).toMatchObject({
                userId: 'u1',
            });
        });

        it('refuses an ERP app token', () => {
            expect(handle({ userId: 'u1', scope: AUTH_SCOPE_APP })).toThrow(
                'Sign in to the careers portal to continue',
            );
        });

        it('refuses a storefront customer token', () => {
            expect(handle({ userId: 'u1', scope: AUTH_SCOPE_STOREFRONT })).toThrow(
                'Sign in to the careers portal to continue',
            );
        });

        it('refuses a pre-scope legacy token, which is an app token by definition', () => {
            expect(handle({ userId: 'u1' })).toThrow('Sign in to the careers portal to continue');
        });
    });

    describe('JobSeekerGuard', () => {
        const db = { jobSeeker: { findFirst: jest.fn() } } as any;

        const contextFor = (user: any) => {
            const req: any = { user };
            return {
                switchToHttp: () => ({ getRequest: () => req }),
                __req: req,
            } as any;
        };

        beforeEach(() => db.jobSeeker.findFirst.mockReset());

        it('resolves the applicant from the token, never from a parameter', async () => {
            db.jobSeeker.findFirst.mockResolvedValue({ id: 'seeker-1', full_name: 'Karim' });
            const context = contextFor({ userId: 'user-1', scope: AUTH_SCOPE_APPLICANT });

            await new JobSeekerGuard(db).canActivate(context);

            expect(db.jobSeeker.findFirst.mock.calls[0][0].where).toEqual({
                user_id: 'user-1',
                deleted_at: null,
            });
            expect(context.__req.jobSeeker.id).toBe('seeker-1');
        });

        it('never sets a tenant on the request', async () => {
            db.jobSeeker.findFirst.mockResolvedValue({ id: 'seeker-1', full_name: 'Karim' });
            const context = contextFor({ userId: 'user-1', scope: AUTH_SCOPE_APPLICANT });

            await new JobSeekerGuard(db).canActivate(context);

            expect(context.__req.tenantId).toBeUndefined();
        });

        it('re-checks the scope rather than assuming CareersJwtGuard ran', async () => {
            const context = contextFor({ userId: 'user-1', scope: AUTH_SCOPE_APP });

            await expect(new JobSeekerGuard(db).canActivate(context)).rejects.toThrow(
                'Sign in to the careers portal to continue',
            );
            expect(db.jobSeeker.findFirst).not.toHaveBeenCalled();
        });

        it('refuses a token whose user has no applicant profile', async () => {
            db.jobSeeker.findFirst.mockResolvedValue(null);
            const context = contextFor({ userId: 'user-1', scope: AUTH_SCOPE_APPLICANT });

            await expect(new JobSeekerGuard(db).canActivate(context)).rejects.toThrow(
                'No careers profile found for this account',
            );
        });
    });

    /**
     * The public board takes an optional token purely to flag "already applied".
     * A non-applicant token must be treated as anonymous there, not resolved
     * into an applicant identity.
     */
    describe('the public board with an optional token', () => {
        let app: INestApplication;
        const service = {
            listJobs: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 1 }),
            getJob: jest.fn().mockResolvedValue({}),
            listHiringCompanies: jest.fn().mockResolvedValue([]),
        };
        const db = { jobSeeker: { findFirst: jest.fn().mockResolvedValue({ id: 'seeker-1' }) } };
        let currentUser: any = null;

        beforeAll(async () => {
            class MockOptionalGuard {
                canActivate(context: any) {
                    context.switchToHttp().getRequest().user = currentUser;
                    return true;
                }
            }

            const moduleRef = await Test.createTestingModule({
                controllers: [CareersPublicController, CareersPortalController],
                providers: [
                    { provide: CareersService, useValue: service },
                    { provide: DatabaseService, useValue: db },
                    { provide: AssetsService, useValue: {} },
                ],
            })
                .overrideGuard(require('../auth/optional-jwt-auth.guard').OptionalJwtAuthGuard)
                .useClass(MockOptionalGuard)
                .overrideGuard(CareersJwtGuard)
                .useValue({ canActivate: () => false })
                .overrideGuard(JobSeekerGuard)
                .useValue({ canActivate: () => false })
                .compile();

            app = moduleRef.createNestApplication();
            await app.init();
        });

        afterAll(async () => app?.close());

        beforeEach(() => {
            service.listJobs.mockClear();
            db.jobSeeker.findFirst.mockClear();
        });

        it('passes the applicant id for an applicant token', async () => {
            currentUser = { userId: 'user-1', scope: AUTH_SCOPE_APPLICANT };

            await request(app.getHttpServer()).get('/careers/jobs').expect(200);

            expect(service.listJobs.mock.calls[0][1]).toBe('seeker-1');
        });

        it('treats an ERP token as anonymous instead of resolving a profile', async () => {
            currentUser = { userId: 'user-1', scope: AUTH_SCOPE_APP };

            await request(app.getHttpServer()).get('/careers/jobs').expect(200);

            expect(service.listJobs.mock.calls[0][1]).toBeUndefined();
            expect(db.jobSeeker.findFirst).not.toHaveBeenCalled();
        });

        it('serves an anonymous visitor', async () => {
            currentUser = null;

            await request(app.getHttpServer()).get('/careers/jobs').expect(200);

            expect(service.listJobs.mock.calls[0][1]).toBeUndefined();
        });
    });
});
