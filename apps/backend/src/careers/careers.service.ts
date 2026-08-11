import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CareersApplicationStage, isCareersTerminalStage } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { AUTH_SCOPE_APPLICANT } from '../auth/token-scope';
import { paginate } from '../common/pagination.dto';
import {
    CareersApplyDto,
    CareersJobQueryDto,
    CareersLoginDto,
    CareersRegisterDto,
    UpdateCareersProfileDto,
} from './careers.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * The public careers board and the job seeker's portal — the applicant-facing
 * half of recruitment. `RecruitmentService` is the hiring workspace's half, and
 * the two work the **same rows**: this file writes `Applicant` and
 * `JobApplication` inside the hiring tenant, and the workspace's own screens
 * pick them up with no import step.
 *
 * Three things make this module unlike every other one here:
 *
 * 1. **It reads across tenants.** The board lists published vacancies from
 *    every workspace and the portal lists one person's applications to all of
 *    them. There is no `tenantId` parameter in this file because there is no
 *    single tenant to scope to. What replaces tenant scoping as the safety rule
 *    is `jobSeekerId` — taken from `request.jobSeeker`, set by `JobSeekerGuard`
 *    off the token — reached through `Applicant.user_id`. Every portal query
 *    filters on it in the `where`, so a wrong id is a 404 rather than a leak.
 *
 * 2. **It writes rows another tenant owns.** Applying creates an `Applicant`
 *    and a `JobApplication` inside the hiring workspace. That is the only
 *    cross-tenant write on the platform, and it is confined to `apply()` below,
 *    which copies `tenant_id` off the post rather than accepting one.
 *
 * 3. **It hands data back to the person it is about.** The hiring module keeps
 *    `notes`, `rating`, `rejection_reason`, `source` and the event `note` on
 *    the same rows the portal reads. None of them are ever selected here — see
 *    `applicationSelect()`, which is an allow-list precisely so that a field
 *    added to the model later is not published by default.
 */
@Injectable()
export class CareersService {
    constructor(
        private readonly db: DatabaseService,
        private readonly jwt: JwtService,
        private readonly totp: TotpService,
        private readonly audit: AuditService,
    ) {}

    // ── The public board ──────────────────────────────────────────────────────

    /**
     * Every vacancy advertised on the platform.
     *
     * "Advertised" is narrower than the hiring module's OPEN: it also needs
     * `publish_to_board`, because OPEN already meant "we are hiring for this"
     * before a public board existed and reusing it would have published every
     * existing post on deploy. A post past its `closing_date` drops off without
     * anyone closing it, and the same predicate gates `apply()` so the board and
     * the apply button cannot disagree.
     */
    async listJobs(query: CareersJobQueryDto, jobSeekerId?: string) {
        const page = Math.max(query.page ?? 1, 1);
        const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

        const where: any = {
            ...this.listedPostWhere(),
            ...(query.company_id ? { tenant_id: query.company_id } : {}),
            ...(query.employment_type ? { employment_type: query.employment_type } : {}),
            ...(query.location
                ? { location: { contains: query.location, mode: 'insensitive' } }
                : {}),
            // Under `AND`, not as a sibling `OR`: `listedPostWhere` already owns
            // the top-level `OR` (for `closing_date`), and a sibling key would
            // replace it — silently resurfacing expired vacancies the moment
            // somebody typed in the search box.
            ...(query.search
                ? {
                      AND: [
                          {
                              OR: [
                                  { title: { contains: query.search, mode: 'insensitive' } },
                                  { description: { contains: query.search, mode: 'insensitive' } },
                              ],
                          },
                      ],
                  }
                : {}),
        };

        const [rows, total] = await Promise.all([
            this.db.jobPost.findMany({
                where,
                orderBy: [{ opened_at: 'desc' }, { created_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                select: this.postSummarySelect(),
            }),
            this.db.jobPost.count({ where }),
        ]);

        const appliedTo = await this.appliedPostIds(
            jobSeekerId,
            rows.map((row) => row.id),
        );

        return paginate(
            rows.map((row) => this.toJobSummary(row, appliedTo)),
            total,
            page,
            limit,
        );
    }

    async getJob(id: string, jobSeekerId?: string) {
        const post = await this.db.jobPost.findFirst({
            where: { id, ...this.listedPostWhere() },
            select: {
                ...this.postSummarySelect(),
                description: true,
                requirements: true,
            },
        });

        if (!post) throw new NotFoundException('This job is no longer accepting applications');

        const appliedTo = await this.appliedPostIds(jobSeekerId, [post.id]);

        return {
            ...this.toJobSummary(post, appliedTo),
            description: post.description,
            requirements: post.requirements,
        };
    }

    /** Companies with at least one listed vacancy — drives the board's filter. */
    async listHiringCompanies() {
        const groups = await this.db.jobPost.groupBy({
            by: ['tenant_id'],
            where: this.listedPostWhere(),
            _count: { _all: true },
        });

        if (!groups.length) return [];

        const tenants = await this.db.tenant.findMany({
            where: { id: { in: groups.map((g) => g.tenant_id) } },
            select: { id: true, name: true, brand_business_name: true },
        });
        const byId = new Map(tenants.map((t) => [t.id, t]));

        return groups
            .map((group) => {
                const tenant = byId.get(group.tenant_id);
                return {
                    id: group.tenant_id,
                    name: tenant?.brand_business_name || tenant?.name || 'Unnamed company',
                    open_jobs: group._count._all,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // ── Sign-up and sign-in ───────────────────────────────────────────────────

    /**
     * Create (or attach) a careers login.
     *
     * An email already on the platform is not an error: a shop owner or an
     * existing shopper may also be job-hunting. Their password proves the
     * account is theirs and a `JobSeeker` is attached to the same `User` —
     * which is how one login ends up spanning every company.
     */
    async register(dto: CareersRegisterDto) {
        let user = await this.db.user.findUnique({ where: { email: dto.email } });

        if (user) {
            // A Google-only account has no hash to compare against, so it can
            // never be claimed here — they sign in instead.
            const valid = user.passwordHash
                ? await bcrypt.compare(dto.password, user.passwordHash)
                : false;
            if (!valid) {
                throw new ConflictException(
                    'An account with this email already exists. Please sign in instead.',
                );
            }

            const existing = await this.db.jobSeeker.findFirst({
                where: { user_id: user.id, deleted_at: null },
            });
            if (existing) {
                throw new ConflictException('You already have a careers profile. Please sign in.');
            }
        } else {
            const passwordHash = await bcrypt.hash(dto.password, 10);
            user = await this.db.user.create({
                data: { email: dto.email, name: dto.full_name, passwordHash },
            });
        }

        const jobSeeker = await this.db.jobSeeker.upsert({
            where: { user_id: user.id },
            // A soft-deleted profile is revived rather than duplicated: `user_id`
            // is unique, so a second row is not possible anyway.
            update: { full_name: dto.full_name, phone: dto.phone, deleted_at: null },
            create: { user_id: user.id, full_name: dto.full_name, phone: dto.phone },
        });

        this.audit
            .log('CAREERS_SIGNUP', 'JobSeeker', { userId: user.id }, jobSeeker.id, {
                email: dto.email,
            })
            .catch(() => {});

        // Signing up against an existing account only proves the password. If
        // that account carries a second factor, it applies here too.
        if (this.totp.isEnabled(user.totp_secret)) {
            return { requires_2fa: true, user_id: user.id };
        }

        return this.issueSession(user, jobSeeker);
    }

    async login(dto: CareersLoginDto) {
        const user = await this.db.user.findUnique({ where: { email: dto.email } });

        if (!user || !user.passwordHash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const jobSeeker = await this.db.jobSeeker.findFirst({
            where: { user_id: user.id, deleted_at: null },
        });
        if (!jobSeeker) {
            throw new UnauthorizedException(
                'No careers profile found for this account. Please sign up first.',
            );
        }

        if (this.totp.isEnabled(user.totp_secret)) {
            return { requires_2fa: true, user_id: user.id };
        }

        this.audit
            .log('CAREERS_LOGIN', 'JobSeeker', { userId: user.id }, jobSeeker.id)
            .catch(() => {});

        return this.issueSession(user, jobSeeker);
    }

    /** Second leg of a 2FA careers login: exchange a TOTP code for the session. */
    async completeTwoFactorLogin(userId: string, code: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const jobSeeker = await this.db.jobSeeker.findFirst({
            where: { user_id: user.id, deleted_at: null },
        });
        if (!jobSeeker) {
            throw new UnauthorizedException('No careers profile found for this account');
        }

        await this.totp.verifyTotpForLogin(userId, code);

        this.audit
            .log('CAREERS_LOGIN', 'JobSeeker', { userId: user.id }, jobSeeker.id, {
                two_factor: true,
            })
            .catch(() => {});

        return this.issueSession(user, jobSeeker);
    }

    /**
     * Revoke every careers session for this person. Bumps only
     * `applicant_token_version`, so their ERP workspace and storefront sessions
     * (if any) survive — the rule the storefront logout already follows.
     */
    async logout(userId: string) {
        await this.db.user.update({
            where: { id: userId },
            data: { applicant_token_version: { increment: 1 } },
        });
        this.audit.log('CAREERS_LOGOUT', 'JobSeeker', { userId }, userId).catch(() => {});
    }

    // ── The profile ───────────────────────────────────────────────────────────

    async getProfile(jobSeekerId: string) {
        const seeker = await this.db.jobSeeker.findFirst({
            where: { id: jobSeekerId, deleted_at: null },
            select: {
                id: true,
                full_name: true,
                phone: true,
                headline: true,
                location: true,
                summary: true,
                resume_url: true,
                resume_name: true,
                linkedin_url: true,
                portfolio_url: true,
                user: {
                    select: {
                        email: true,
                        email_verified_at: true,
                        mobile_verified_at: true,
                    },
                },
            },
        });

        if (!seeker) throw new NotFoundException('Profile not found');

        const { user, ...rest } = seeker;
        return {
            ...rest,
            email: user.email,
            // Surfaced because they decide whether an existing candidate record
            // at a company can be claimed — see `resolveApplicant`.
            email_verified: Boolean(user.email_verified_at),
            mobile_verified: Boolean(user.mobile_verified_at),
        };
    }

    async updateProfile(jobSeekerId: string, dto: UpdateCareersProfileDto) {
        await this.db.jobSeeker.update({
            where: { id: jobSeekerId },
            data: {
                ...(dto.full_name !== undefined && { full_name: dto.full_name }),
                ...(dto.phone !== undefined && { phone: dto.phone || null }),
                ...(dto.headline !== undefined && { headline: dto.headline || null }),
                ...(dto.location !== undefined && { location: dto.location || null }),
                ...(dto.summary !== undefined && { summary: dto.summary || null }),
                ...(dto.resume_url !== undefined && { resume_url: dto.resume_url || null }),
                ...(dto.resume_name !== undefined && { resume_name: dto.resume_name || null }),
                ...(dto.linkedin_url !== undefined && { linkedin_url: dto.linkedin_url || null }),
                ...(dto.portfolio_url !== undefined && { portfolio_url: dto.portfolio_url || null }),
            },
        });

        return this.getProfile(jobSeekerId);
    }

    /** Store an uploaded CV against the profile. */
    async setResume(jobSeekerId: string, url: string, fileName: string) {
        await this.db.jobSeeker.update({
            where: { id: jobSeekerId },
            data: { resume_url: url, resume_name: fileName },
        });
        return this.getProfile(jobSeekerId);
    }

    // ── Applications ──────────────────────────────────────────────────────────

    async listMyApplications(jobSeekerId: string) {
        const userId = await this.userIdFor(jobSeekerId);

        const rows = await this.db.jobApplication.findMany({
            // The walk that replaces tenant scoping: only applications whose
            // candidate record belongs to this login.
            where: { deleted_at: null, applicant: { is: { user_id: userId } } },
            orderBy: { applied_at: 'desc' },
            select: this.applicationSelect(),
        });

        return rows.map((row) => this.toApplication(row));
    }

    async getMyApplication(jobSeekerId: string, id: string) {
        const userId = await this.userIdFor(jobSeekerId);

        const row = await this.db.jobApplication.findFirst({
            // The ownership filter is in the `where`, not a post-hoc check, so
            // another candidate's id is a 404 and ids cannot be probed.
            where: { id, deleted_at: null, applicant: { is: { user_id: userId } } },
            select: {
                ...this.applicationSelect(),
                events: {
                    orderBy: { created_at: 'asc' },
                    // Note what is absent: `note`. The hiring module's event note
                    // is where interviewers write internal remarks.
                    select: { id: true, to_stage: true, created_at: true },
                },
            },
        });

        if (!row) throw new NotFoundException('Application not found');

        return { ...this.toApplication(row), timeline: (row as any).events };
    }

    /**
     * Apply to a listed vacancy.
     *
     * The only cross-tenant write on the platform. `tenant_id` is copied off the
     * post, never taken from the caller, so an application always lands in the
     * workspace that owns the vacancy — and lands as an ordinary `Applicant` +
     * `JobApplication` pair, so it shows up on the workspace's existing
     * recruitment screens with nothing to import.
     */
    async apply(jobSeekerId: string, jobId: string, dto: CareersApplyDto) {
        const post = await this.db.jobPost.findFirst({
            where: { id: jobId, ...this.listedPostWhere() },
            select: { id: true, tenant_id: true, title: true },
        });

        if (!post) {
            throw new NotFoundException('This job is no longer accepting applications');
        }

        const seeker = await this.db.jobSeeker.findFirst({
            where: { id: jobSeekerId, deleted_at: null },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        mobile: true,
                        email_verified_at: true,
                        mobile_verified_at: true,
                    },
                },
            },
        });
        if (!seeker) throw new NotFoundException('Profile not found');

        if (!seeker.phone) {
            throw new BadRequestException('Add your mobile number to your profile before applying');
        }
        if (!seeker.resume_url) {
            throw new BadRequestException('Add a CV to your profile before applying');
        }

        const applicant = await this.resolveApplicant(post.tenant_id, seeker);

        const existing = await this.db.jobApplication.findUnique({
            where: {
                job_post_id_applicant_id: { job_post_id: post.id, applicant_id: applicant.id },
            },
            select: { id: true, stage: true, deleted_at: true },
        });

        if (existing && !existing.deleted_at && existing.stage !== CareersApplicationStage.WITHDRAWN) {
            throw new ConflictException('You have already applied to this job');
        }

        const now = new Date();
        const applied = await this.db.$transaction(async (tx) => {
            const application = existing
                ? // Re-applying after withdrawing reuses the row the unique index
                  // already reserved, and resets the clock so the workspace sees
                  // a fresh submission rather than a stale `applied_at`.
                  await tx.jobApplication.update({
                      where: { id: existing.id },
                      data: {
                          stage: CareersApplicationStage.APPLIED,
                          cover_letter: dto.cover_letter ?? null,
                          expected_salary: dto.expected_salary ?? null,
                          applied_at: now,
                          stage_changed_at: now,
                          deleted_at: null,
                      },
                  })
                : await tx.jobApplication.create({
                      data: {
                          tenant_id: post.tenant_id,
                          job_post_id: post.id,
                          applicant_id: applicant.id,
                          stage: CareersApplicationStage.APPLIED,
                          cover_letter: dto.cover_letter ?? null,
                          expected_salary: dto.expected_salary ?? null,
                          // The channel this candidate arrived through, in the
                          // same free-text column HR types "walk-in" into.
                          source: 'Careers board',
                          applied_at: now,
                          stage_changed_at: now,
                      },
                  });

            await tx.jobApplicationEvent.create({
                data: {
                    tenant_id: post.tenant_id,
                    application_id: application.id,
                    from_stage: existing ? CareersApplicationStage.WITHDRAWN : null,
                    to_stage: CareersApplicationStage.APPLIED,
                    note: existing
                        ? 'Re-applied through the careers board'
                        : 'Applied through the careers board',
                },
            });

            return application;
        });

        this.audit
            .log(
                'CAREERS_APPLICATION_SUBMITTED',
                'JobApplication',
                { tenantId: post.tenant_id, userId: seeker.user.id },
                applied.id,
                { job_post_id: post.id, title: post.title },
            )
            .catch(() => {});

        return this.getMyApplication(jobSeekerId, applied.id);
    }

    async withdraw(jobSeekerId: string, id: string) {
        const userId = await this.userIdFor(jobSeekerId);

        const application = await this.db.jobApplication.findFirst({
            where: { id, deleted_at: null, applicant: { is: { user_id: userId } } },
            select: { id: true, stage: true, tenant_id: true },
        });

        if (!application) throw new NotFoundException('Application not found');

        if (isCareersTerminalStage(application.stage as CareersApplicationStage)) {
            throw new BadRequestException(
                application.stage === CareersApplicationStage.WITHDRAWN
                    ? 'This application is already withdrawn'
                    : 'This application has already been decided',
            );
        }

        const now = new Date();
        await this.db.$transaction(async (tx) => {
            await tx.jobApplication.update({
                where: { id: application.id },
                data: { stage: CareersApplicationStage.WITHDRAWN, stage_changed_at: now },
            });
            await tx.jobApplicationEvent.create({
                data: {
                    tenant_id: application.tenant_id,
                    application_id: application.id,
                    from_stage: application.stage,
                    to_stage: CareersApplicationStage.WITHDRAWN,
                    note: 'Withdrawn by the candidate',
                },
            });
        });

        this.audit
            .log(
                'CAREERS_APPLICATION_WITHDRAWN',
                'JobApplication',
                { tenantId: application.tenant_id, userId },
                application.id,
            )
            .catch(() => {});

        return this.getMyApplication(jobSeekerId, application.id);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /**
     * Find, claim or create this person's candidate record at one company.
     *
     * The delicate one. `Applicant` is unique on `[tenant_id, phone]`, so when a
     * workspace has already typed in a walk-in candidate with the same number,
     * creating a second row is not merely untidy — it is impossible. The row has
     * to be reused.
     *
     * Reusing it is also a way to hand somebody another person's interview
     * history, because a phone number typed into a signup form proves nothing.
     * So a claim requires the platform to have **verified** the matching
     * identifier: `email_verified_at` for the email, `mobile_verified_at` for
     * the number. When it cannot verify and the number is taken, the honest
     * answer is to refuse and say why, rather than guess.
     */
    private async resolveApplicant(tenantId: string, seeker: any) {
        const user = seeker.user;

        // 1. Already linked at this company — the common case after the first
        //    application. Refresh the snapshot so the workspace sees current
        //    details rather than whatever was true a year ago.
        const linked = await this.db.applicant.findFirst({
            where: { tenant_id: tenantId, user_id: user.id, deleted_at: null },
            select: { id: true },
        });
        if (linked) {
            return this.db.applicant.update({
                where: { id: linked.id },
                data: this.applicantSnapshot(seeker),
                select: { id: true },
            });
        }

        // 2. An unclaimed record this person can prove is theirs.
        const verifiedMatches: any[] = [];
        if (user.email_verified_at && user.email) {
            verifiedMatches.push({ email: { equals: user.email, mode: 'insensitive' as const } });
        }
        if (user.mobile_verified_at && user.mobile) {
            verifiedMatches.push({ phone: user.mobile });
        }
        if (seeker.phone && user.mobile_verified_at && user.mobile === seeker.phone) {
            verifiedMatches.push({ phone: seeker.phone });
        }

        if (verifiedMatches.length) {
            const claimable = await this.db.applicant.findFirst({
                where: {
                    tenant_id: tenantId,
                    user_id: null,
                    deleted_at: null,
                    OR: verifiedMatches,
                },
                select: { id: true },
            });
            if (claimable) {
                return this.db.applicant.update({
                    where: { id: claimable.id },
                    data: { user_id: user.id, ...this.applicantSnapshot(seeker) },
                    select: { id: true },
                });
            }
        }

        // 3. The number is taken at this company and nothing proves it is
        //    theirs. Refusing is the only safe answer, and the message says how
        //    to get past it.
        const phoneTaken = await this.db.applicant.findFirst({
            where: { tenant_id: tenantId, phone: seeker.phone },
            select: { id: true },
        });
        if (phoneTaken) {
            throw new ConflictException(
                'This company already has a candidate record with your mobile number. '
                    + 'Verify your mobile number on your profile to link it, or contact them directly.',
            );
        }

        // 4. Nobody here knows them yet.
        return this.db.applicant.create({
            data: {
                tenant_id: tenantId,
                user_id: user.id,
                phone: seeker.phone,
                ...this.applicantSnapshot(seeker),
                source: 'Careers board',
            },
            select: { id: true },
        });
    }

    /**
     * The fields the portal owns on a tenant's candidate record.
     *
     * Deliberately narrow: `notes`, `rating`, `source` and the rest belong to
     * the workspace, and a profile edit must not overwrite what an interviewer
     * wrote. `phone` is set on create only — changing it later could collide
     * with the tenant's unique index and is not the portal's business.
     */
    private applicantSnapshot(seeker: any) {
        return {
            name: seeker.full_name,
            email: seeker.user.email,
            current_designation: seeker.headline ?? null,
            address: seeker.location ?? null,
            resume_url: seeker.resume_url ?? null,
        };
    }

    /**
     * The board's definition of a listed vacancy, in one place so the listing,
     * the detail page and `apply()` cannot drift apart. A soft-deleted
     * workspace's posts disappear with it — `Tenant.deleted_at` is a soft
     * delete, so the cascade on the foreign key never fires.
     */
    private listedPostWhere() {
        const now = new Date();
        return {
            status: 'OPEN' as const,
            publish_to_board: true,
            deleted_at: null,
            tenant: { deleted_at: null },
            OR: [{ closing_date: null }, { closing_date: { gte: now } }],
        };
    }

    private postSummarySelect() {
        return {
            id: true,
            code: true,
            title: true,
            location: true,
            employment_type: true,
            salary_min: true,
            salary_max: true,
            openings: true,
            opened_at: true,
            closing_date: true,
            department: { select: { name: true } },
            tenant: { select: { id: true, name: true, brand_business_name: true } },
        };
    }

    /** Which of these posts the signed-in job seeker has a live application on. */
    private async appliedPostIds(jobSeekerId: string | undefined, postIds: string[]) {
        if (!jobSeekerId || !postIds.length) return new Set<string>();

        const userId = await this.userIdFor(jobSeekerId);

        const rows = await this.db.jobApplication.findMany({
            where: {
                job_post_id: { in: postIds },
                deleted_at: null,
                applicant: { is: { user_id: userId } },
                // A withdrawn application does not count: the flag exists to
                // disable "Apply", and withdrawing is meant to re-enable it.
                stage: { not: CareersApplicationStage.WITHDRAWN },
            },
            select: { job_post_id: true },
        });

        return new Set(rows.map((row) => row.job_post_id));
    }

    private async userIdFor(jobSeekerId: string): Promise<string> {
        const seeker = await this.db.jobSeeker.findFirst({
            where: { id: jobSeekerId, deleted_at: null },
            select: { user_id: true },
        });
        if (!seeker) throw new NotFoundException('Profile not found');
        return seeker.user_id;
    }

    private toJobSummary(row: any, appliedTo: Set<string>) {
        return {
            id: row.id,
            code: row.code,
            title: row.title,
            location: row.location,
            employment_type: row.employment_type,
            salary_min: row.salary_min === null ? null : Number(row.salary_min),
            salary_max: row.salary_max === null ? null : Number(row.salary_max),
            openings: row.openings,
            opened_at: row.opened_at,
            closing_date: row.closing_date,
            department: row.department?.name ?? null,
            company: {
                id: row.tenant.id,
                name: row.tenant.brand_business_name || row.tenant.name,
            },
            already_applied: appliedTo.has(row.id),
        };
    }

    /**
     * An allow-list, and the reason the hiring workspace can keep private
     * remarks on rows the portal reads. Absent on purpose: `notes`, `rating`,
     * `rejection_reason`, `source`, `hired_employee_id`, and everything on the
     * `Applicant` row except what the candidate supplied themselves.
     */
    private applicationSelect() {
        return {
            id: true,
            stage: true,
            applied_at: true,
            stage_changed_at: true,
            expected_salary: true,
            cover_letter: true,
            jobPost: {
                select: {
                    id: true,
                    code: true,
                    title: true,
                    location: true,
                    employment_type: true,
                    status: true,
                    publish_to_board: true,
                    deleted_at: true,
                },
            },
            applicant: { select: { resume_url: true } },
            tenant: { select: { id: true, name: true, brand_business_name: true } },
        };
    }

    private toApplication(row: any) {
        return {
            id: row.id,
            stage: row.stage,
            applied_at: row.applied_at,
            stage_changed_at: row.stage_changed_at,
            expected_salary: row.expected_salary === null ? null : Number(row.expected_salary),
            cover_letter: row.cover_letter,
            resume_url: row.applicant?.resume_url ?? null,
            job: {
                id: row.jobPost.id,
                code: row.jobPost.code,
                title: row.jobPost.title,
                location: row.jobPost.location,
                employment_type: row.jobPost.employment_type,
                // Whether the candidate can still open the public page for it.
                still_listed:
                    row.jobPost.status === 'OPEN'
                    && row.jobPost.publish_to_board === true
                    && row.jobPost.deleted_at === null,
            },
            company: {
                id: row.tenant.id,
                name: row.tenant.brand_business_name || row.tenant.name,
            },
        };
    }

    private issueSession(user: any, jobSeeker: { id: string; full_name: string }) {
        const payload = {
            sub: user.id,
            email: user.email,
            // `atv`, not `tv` — careers sessions revoke independently of the app's.
            atv: user.applicant_token_version ?? 0,
            scope: AUTH_SCOPE_APPLICANT,
        };

        return {
            access_token: this.jwt.sign(payload),
            applicant: {
                id: jobSeeker.id,
                full_name: jobSeeker.full_name,
                email: user.email,
            },
        };
    }
}
