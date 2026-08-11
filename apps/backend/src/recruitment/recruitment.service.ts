import {
    BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmployeesService } from '../employees/employees.service';
import { TenantContext } from '../database/tenant.decorator';
import {
    APPLICATION_STAGES, ApplicationStage, ChangeStageDto, CreateApplicantDto,
    CreateApplicationDto, CreateJobPostDto, HireApplicationDto, ListApplicationsQueryDto,
    ListJobPostsQueryDto, UpdateApplicantDto, UpdateApplicationDto, UpdateJobPostDto,
} from './recruitment.dto';

/**
 * Recruitment — vacancies, candidates, and the pipeline between them.
 *
 * Three tables rather than one because they have three different lifetimes: a
 * job post outlives the people who apply to it, an applicant outlives any one
 * application, and an application is the only thing that actually moves. The
 * consequence worth naming is that somebody who applies twice in two years is
 * one `Applicant` with two `JobApplication`s — the interviewer can see the
 * earlier round instead of re-discovering it.
 */
@Injectable()
export class RecruitmentService {
    constructor(
        private readonly db: DatabaseService,
        private readonly employees: EmployeesService,
    ) {}

    /** Stages a candidate can still move through. Everything else is terminal. */
    private static readonly OPEN_STAGES: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
    private static readonly TERMINAL_STAGES: ApplicationStage[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];

    private isTerminal(stage: string) {
        return RecruitmentService.TERMINAL_STAGES.includes(stage as ApplicationStage);
    }

    // ── Job posts ─────────────────────────────────────────────────────────────

    /**
     * `JOB-00001`, per tenant.
     *
     * Ordered by code rather than by date because that is what makes the next
     * number the successor of the highest one issued, not of the most recent
     * row — a post created after a backfilled one must not reuse its number.
     */
    private async generateJobCode(tenantId: string): Promise<string> {
        const last = await this.db.jobPost.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { code: 'desc' },
            select: { code: true },
        });
        if (!last) return 'JOB-00001';
        const match = last.code.match(/JOB-(\d+)/);
        const next = match ? parseInt(match[1], 10) + 1 : 1;
        return `JOB-${String(next).padStart(5, '0')}`;
    }

    private async assertDepartment(tenantId: string, id?: string) {
        if (!id) return;
        const found = await this.db.department.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!found) throw new BadRequestException('Department not found.');
    }

    private async assertDesignation(tenantId: string, id?: string) {
        if (!id) return;
        const found = await this.db.designation.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!found) throw new BadRequestException('Designation not found.');
    }

    private async assertEmployee(tenantId: string, id?: string) {
        if (!id) return;
        const found = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!found) throw new BadRequestException('Employee not found.');
    }

    private validateSalaryBand(min?: number | null, max?: number | null) {
        if (min != null && max != null && Number(min) > Number(max)) {
            throw new BadRequestException('Minimum salary cannot be greater than maximum salary.');
        }
    }

    async listJobPosts(tenantId: string, query: ListJobPostsQueryDto = {}) {
        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (query.status) where.status = query.status;
        if (query.department_id) where.department_id = query.department_id;
        if (query.search) {
            where.OR = [
                { title: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
            ];
        }

        const posts = await this.db.jobPost.findMany({
            where,
            include: {
                department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
                hiringManager: { select: { id: true, name: true } },
            },
            orderBy: [{ created_at: 'desc' }],
        });

        // Two counts per post, in one pass rather than one query per post: how
        // many applied at all, and how many are still live. A post with 40
        // applicants and none in play is the one that needs attention.
        const grouped = await this.db.jobApplication.groupBy({
            by: ['job_post_id', 'stage'],
            where: { tenant_id: tenantId, deleted_at: null },
            _count: { _all: true },
        });

        const counts = new Map<string, { total: number; open: number; hired: number }>();
        for (const row of grouped) {
            const entry = counts.get(row.job_post_id) ?? { total: 0, open: 0, hired: 0 };
            const n = row._count._all;
            entry.total += n;
            if (RecruitmentService.OPEN_STAGES.includes(row.stage as ApplicationStage)) entry.open += n;
            if (row.stage === 'HIRED') entry.hired += n;
            counts.set(row.job_post_id, entry);
        }

        return posts.map((post) => ({
            ...post,
            application_count: counts.get(post.id)?.total ?? 0,
            open_application_count: counts.get(post.id)?.open ?? 0,
            hired_count: counts.get(post.id)?.hired ?? 0,
        }));
    }

    async getJobPost(tenantId: string, id: string) {
        const post = await this.db.jobPost.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
                hiringManager: { select: { id: true, name: true } },
                applications: {
                    where: { deleted_at: null },
                    include: {
                        applicant: true,
                        hiredEmployee: { select: { id: true, employee_code: true, name: true } },
                    },
                    orderBy: [{ stage_changed_at: 'desc' }],
                },
            },
        });
        if (!post) throw new NotFoundException('Job post not found.');

        const stageCounts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<ApplicationStage, number>;
        for (const application of post.applications) {
            stageCounts[application.stage as ApplicationStage] += 1;
        }

        return { ...post, stage_counts: stageCounts };
    }

    async createJobPost(tenantId: string, dto: CreateJobPostDto) {
        await this.assertDepartment(tenantId, dto.department_id);
        await this.assertDesignation(tenantId, dto.designation_id);
        await this.assertEmployee(tenantId, dto.hiring_manager_id);
        this.validateSalaryBand(dto.salary_min, dto.salary_max);

        const status = dto.status ?? 'DRAFT';
        const code = await this.generateJobCode(tenantId);

        return this.db.jobPost.create({
            data: {
                tenant_id: tenantId,
                code,
                title: dto.title,
                department_id: dto.department_id ?? null,
                designation_id: dto.designation_id ?? null,
                hiring_manager_id: dto.hiring_manager_id ?? null,
                employment_type: (dto.employment_type ?? 'FULL_TIME') as any,
                location: dto.location ?? null,
                openings: dto.openings ?? 1,
                salary_min: dto.salary_min ?? null,
                salary_max: dto.salary_max ?? null,
                description: dto.description ?? null,
                requirements: dto.requirements ?? null,
                status: status as any,
                // A post that goes straight to OPEN was opened today; a draft has
                // not been opened at all, and dating it would overstate it.
                opened_at: status === 'OPEN' ? new Date() : null,
                closing_date: dto.closing_date ? new Date(dto.closing_date) : null,
            },
            include: {
                department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
            },
        });
    }

    async updateJobPost(tenantId: string, id: string, dto: UpdateJobPostDto) {
        const post = await this.db.jobPost.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!post) throw new NotFoundException('Job post not found.');

        await this.assertDepartment(tenantId, dto.department_id);
        await this.assertDesignation(tenantId, dto.designation_id);
        await this.assertEmployee(tenantId, dto.hiring_manager_id);
        this.validateSalaryBand(
            dto.salary_min ?? (post.salary_min == null ? null : Number(post.salary_min)),
            dto.salary_max ?? (post.salary_max == null ? null : Number(post.salary_max)),
        );

        const patch: any = {};
        for (const key of ['title', 'location', 'description', 'requirements'] as const) {
            if (dto[key] !== undefined) patch[key] = dto[key];
        }
        for (const key of ['department_id', 'designation_id', 'hiring_manager_id'] as const) {
            if (dto[key] !== undefined) patch[key] = dto[key] || null;
        }
        if (dto.employment_type !== undefined) patch.employment_type = dto.employment_type;
        if (dto.openings !== undefined) patch.openings = dto.openings;
        if (dto.salary_min !== undefined) patch.salary_min = dto.salary_min;
        if (dto.salary_max !== undefined) patch.salary_max = dto.salary_max;
        if (dto.closing_date !== undefined) {
            patch.closing_date = dto.closing_date ? new Date(dto.closing_date) : null;
        }
        if (dto.status !== undefined) {
            patch.status = dto.status;
            // Stamp the opening date the first time it goes live and never again,
            // so re-opening a paused post keeps the date candidates saw.
            if (dto.status === 'OPEN' && !post.opened_at) patch.opened_at = new Date();
        }

        return this.db.jobPost.update({
            where: { id },
            data: patch,
            include: {
                department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
            },
        });
    }

    async deleteJobPost(tenantId: string, id: string) {
        const post = await this.db.jobPost.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!post) throw new NotFoundException('Job post not found.');

        const live = await this.db.jobApplication.count({
            where: { job_post_id: id, deleted_at: null, stage: { in: RecruitmentService.OPEN_STAGES as any } },
        });
        if (live > 0) {
            throw new BadRequestException(
                'This post still has candidates in the pipeline. Close it instead, or reject the remaining applications first.',
            );
        }

        return this.db.jobPost.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Applicants ────────────────────────────────────────────────────────────

    async listApplicants(tenantId: string, opts: { search?: string } = {}) {
        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { email: { contains: opts.search, mode: 'insensitive' } },
                { skills: { contains: opts.search, mode: 'insensitive' } },
                { current_company: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const applicants = await this.db.applicant.findMany({
            where,
            include: {
                _count: { select: { applications: true } },
                applications: {
                    where: { deleted_at: null },
                    select: { id: true, stage: true, jobPost: { select: { id: true, title: true } } },
                    orderBy: { applied_at: 'desc' },
                    take: 5,
                },
            },
            orderBy: { created_at: 'desc' },
        });

        return applicants.map(({ _count, ...applicant }) => ({
            ...applicant,
            application_count: _count.applications,
        }));
    }

    async getApplicant(tenantId: string, id: string) {
        const applicant = await this.db.applicant.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                applications: {
                    where: { deleted_at: null },
                    include: {
                        jobPost: { select: { id: true, code: true, title: true, status: true } },
                        hiredEmployee: { select: { id: true, employee_code: true, name: true } },
                    },
                    orderBy: { applied_at: 'desc' },
                },
            },
        });
        if (!applicant) throw new NotFoundException('Applicant not found.');
        return applicant;
    }

    /**
     * The phone number is the identity: `@@unique([tenant_id, phone])`.
     *
     * A soft-deleted row still holds that number, so a returning candidate is
     * restored rather than rejected as a duplicate of something the tenant
     * cannot see.
     */
    async createApplicant(tenantId: string, dto: CreateApplicantDto) {
        const phone = dto.phone.trim();
        const existing = await this.db.applicant.findFirst({
            where: { tenant_id: tenantId, phone },
        });

        if (existing && !existing.deleted_at) {
            throw new ConflictException('An applicant with this phone number already exists.');
        }

        const data = {
            name: dto.name,
            phone,
            email: dto.email ?? null,
            source: dto.source ?? null,
            current_company: dto.current_company ?? null,
            current_designation: dto.current_designation ?? null,
            experience_years: dto.experience_years ?? null,
            expected_salary: dto.expected_salary ?? null,
            resume_url: dto.resume_url ?? null,
            skills: dto.skills ?? null,
            notes: dto.notes ?? null,
            address: dto.address ?? null,
        };

        if (existing) {
            return this.db.applicant.update({
                where: { id: existing.id },
                data: { ...data, deleted_at: null },
            });
        }

        return this.db.applicant.create({ data: { tenant_id: tenantId, ...data } });
    }

    async updateApplicant(tenantId: string, id: string, dto: UpdateApplicantDto) {
        const applicant = await this.db.applicant.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!applicant) throw new NotFoundException('Applicant not found.');

        if (dto.phone && dto.phone.trim() !== applicant.phone) {
            const duplicate = await this.db.applicant.findFirst({
                where: { tenant_id: tenantId, phone: dto.phone.trim(), deleted_at: null, NOT: { id } },
            });
            if (duplicate) throw new ConflictException('An applicant with this phone number already exists.');
        }

        const patch: any = {};
        const fields = [
            'name', 'email', 'source', 'current_company', 'current_designation',
            'resume_url', 'skills', 'notes', 'address',
        ] as const;
        for (const key of fields) {
            if (dto[key] !== undefined) patch[key] = dto[key] || null;
        }
        if (dto.phone !== undefined) patch.phone = dto.phone.trim();
        if (dto.experience_years !== undefined) patch.experience_years = dto.experience_years;
        if (dto.expected_salary !== undefined) patch.expected_salary = dto.expected_salary;

        return this.db.applicant.update({ where: { id }, data: patch });
    }

    async deleteApplicant(tenantId: string, id: string) {
        const applicant = await this.db.applicant.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!applicant) throw new NotFoundException('Applicant not found.');

        const live = await this.db.jobApplication.count({
            where: { applicant_id: id, deleted_at: null, stage: { in: RecruitmentService.OPEN_STAGES as any } },
        });
        if (live > 0) {
            throw new BadRequestException('This applicant is still in the pipeline for an open job post.');
        }

        return this.db.applicant.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Applications ──────────────────────────────────────────────────────────

    async listApplications(tenantId: string, query: ListApplicationsQueryDto = {}) {
        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (query.job_post_id) where.job_post_id = query.job_post_id;
        if (query.applicant_id) where.applicant_id = query.applicant_id;
        if (query.stage) where.stage = query.stage;
        if (query.stages) {
            const stages = query.stages.split(',').map((s) => s.trim()).filter(Boolean);
            if (stages.length) where.stage = { in: stages };
        }
        if (query.search) {
            where.OR = [
                { applicant: { name: { contains: query.search, mode: 'insensitive' } } },
                { applicant: { phone: { contains: query.search } } },
                { jobPost: { title: { contains: query.search, mode: 'insensitive' } } },
            ];
        }

        return this.db.jobApplication.findMany({
            where,
            include: {
                applicant: {
                    select: {
                        id: true, name: true, phone: true, email: true, resume_url: true,
                        current_company: true, experience_years: true,
                    },
                },
                jobPost: { select: { id: true, code: true, title: true, status: true } },
                hiredEmployee: { select: { id: true, employee_code: true, name: true } },
            },
            orderBy: [{ stage_changed_at: 'desc' }],
        });
    }

    async getApplication(tenantId: string, id: string) {
        const application = await this.db.jobApplication.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                applicant: true,
                jobPost: {
                    select: {
                        id: true, code: true, title: true, status: true, openings: true,
                        department: { select: { id: true, name: true } },
                        designation: { select: { id: true, name: true } },
                    },
                },
                hiredEmployee: { select: { id: true, employee_code: true, name: true } },
                events: {
                    orderBy: { created_at: 'desc' },
                    include: { createdBy: { select: { id: true, name: true, email: true } } },
                },
            },
        });
        if (!application) throw new NotFoundException('Application not found.');
        return application;
    }

    /**
     * Apply someone to a post — either an applicant already on file, or a new
     * one typed into the same form, because the person doing data entry from a
     * stack of CVs should not have to visit two screens per CV.
     */
    async createApplication(tenantId: string, dto: CreateApplicationDto, userId?: string) {
        const post = await this.db.jobPost.findFirst({
            where: { id: dto.job_post_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!post) throw new BadRequestException('Job post not found.');
        if (post.status === 'CLOSED') {
            throw new BadRequestException('This job post is closed and is not accepting applications.');
        }

        let applicantId = dto.applicant_id;
        if (!applicantId) {
            if (!dto.applicant?.name || !dto.applicant?.phone) {
                throw new BadRequestException('Select an existing applicant or provide a name and phone number.');
            }
            // An existing candidate applying for a second role comes in through
            // this branch too — matching on phone reuses them instead of failing
            // on the unique index.
            const existing = await this.db.applicant.findFirst({
                where: { tenant_id: tenantId, phone: dto.applicant.phone.trim(), deleted_at: null },
            });
            applicantId = existing
                ? existing.id
                : (await this.createApplicant(tenantId, dto.applicant)).id;
        } else {
            const applicant = await this.db.applicant.findFirst({
                where: { id: applicantId, tenant_id: tenantId, deleted_at: null },
            });
            if (!applicant) throw new BadRequestException('Applicant not found.');
        }

        const duplicate = await this.db.jobApplication.findFirst({
            where: { job_post_id: post.id, applicant_id: applicantId },
        });
        if (duplicate && !duplicate.deleted_at) {
            throw new ConflictException('This applicant has already applied for this job post.');
        }

        const stage = (dto.stage ?? 'APPLIED') as ApplicationStage;
        const appliedAt = dto.applied_at ? new Date(dto.applied_at) : new Date();
        const data = {
            stage: stage as any,
            applied_at: appliedAt,
            stage_changed_at: new Date(),
            expected_salary: dto.expected_salary ?? null,
            rating: dto.rating ?? null,
            source: dto.source ?? null,
            notes: dto.notes ?? null,
            deleted_at: null,
        };

        const application = duplicate
            ? await this.db.jobApplication.update({ where: { id: duplicate.id }, data })
            : await this.db.jobApplication.create({
                data: {
                    tenant_id: tenantId,
                    job_post_id: post.id,
                    applicant_id: applicantId!,
                    ...data,
                },
            });

        await this.db.jobApplicationEvent.create({
            data: {
                tenant_id: tenantId,
                application_id: application.id,
                from_stage: null,
                to_stage: stage as any,
                note: 'Application received',
                created_by_user_id: userId ?? null,
            },
        });

        return this.getApplication(tenantId, application.id);
    }

    async updateApplication(tenantId: string, id: string, dto: UpdateApplicationDto) {
        const application = await this.db.jobApplication.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!application) throw new NotFoundException('Application not found.');

        const patch: any = {};
        if (dto.expected_salary !== undefined) patch.expected_salary = dto.expected_salary;
        if (dto.rating !== undefined) patch.rating = dto.rating;
        if (dto.source !== undefined) patch.source = dto.source || null;
        if (dto.notes !== undefined) patch.notes = dto.notes || null;

        await this.db.jobApplication.update({ where: { id }, data: patch });
        return this.getApplication(tenantId, id);
    }

    /**
     * Move a candidate along the pipeline, writing the move to the event log.
     *
     * HIRED is deliberately not reachable here: a hire creates an employee
     * record, and letting the stage be set without one would leave the two
     * halves of the same event disagreeing. `hire()` does both together.
     */
    async changeStage(tenantId: string, id: string, dto: ChangeStageDto, userId?: string) {
        const application = await this.db.jobApplication.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!application) throw new NotFoundException('Application not found.');

        if (dto.stage === 'HIRED') {
            throw new BadRequestException('Use the hire action so the employee record is created with the hire.');
        }
        if (application.stage === 'HIRED') {
            throw new BadRequestException('This candidate has already been hired.');
        }
        if (application.stage === dto.stage) {
            throw new BadRequestException('The application is already at this stage.');
        }

        const updated = await this.db.jobApplication.update({
            where: { id },
            data: {
                stage: dto.stage as any,
                stage_changed_at: new Date(),
                // Clearing on any non-rejection move matters when somebody is
                // rejected and then brought back: a stale reason on a live
                // candidate reads as a decision that was never taken.
                rejection_reason: dto.stage === 'REJECTED' ? (dto.rejection_reason ?? null) : null,
            },
        });

        await this.db.jobApplicationEvent.create({
            data: {
                tenant_id: tenantId,
                application_id: id,
                from_stage: application.stage,
                to_stage: dto.stage as any,
                note: dto.note ?? dto.rejection_reason ?? null,
                created_by_user_id: userId ?? null,
            },
        });

        return this.getApplication(tenantId, updated.id);
    }

    /**
     * Accept the offer: create the employee, link it, and mark the post filled
     * when the last opening goes.
     *
     * The employee is created through `EmployeesService` rather than by writing
     * the row here, so employee codes, phone-uniqueness and the payroll
     * visibility rules stay in one place.
     */
    async hire(tenantId: string, id: string, dto: HireApplicationDto, viewer?: TenantContext) {
        const application = await this.db.jobApplication.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: { applicant: true, jobPost: true },
        });
        if (!application) throw new NotFoundException('Application not found.');
        if (application.hired_employee_id) {
            throw new BadRequestException('This candidate has already been hired.');
        }
        if (this.isTerminal(application.stage)) {
            throw new BadRequestException('This application is closed. Move it back into the pipeline before hiring.');
        }

        await this.assertDepartment(tenantId, dto.department_id);
        await this.assertDesignation(tenantId, dto.designation_id);

        const employee = await this.employees.create(
            tenantId,
            {
                name: application.applicant.name,
                phone: application.applicant.phone,
                ...(application.applicant.email ? { email: application.applicant.email } : {}),
                date_of_joining: dto.date_of_joining,
                ...(dto.department_id ?? application.jobPost.department_id
                    ? { department_id: dto.department_id ?? application.jobPost.department_id! }
                    : {}),
                ...(dto.designation_id ?? application.jobPost.designation_id
                    ? { designation_id: dto.designation_id ?? application.jobPost.designation_id! }
                    : {}),
                ...(dto.basic_salary != null ? { basic_salary: dto.basic_salary } : {}),
            } as any,
            viewer,
        );

        await this.db.jobApplication.update({
            where: { id },
            data: {
                stage: 'HIRED' as any,
                stage_changed_at: new Date(),
                rejection_reason: null,
                hired_employee_id: employee.id,
            },
        });

        await this.db.jobApplicationEvent.create({
            data: {
                tenant_id: tenantId,
                application_id: id,
                from_stage: application.stage,
                to_stage: 'HIRED' as any,
                note: `Hired as ${employee.employee_code}`,
                created_by_user_id: viewer?.userId ?? null,
            },
        });

        // The post is filled when hires reach its headcount — not when the first
        // one lands, because a post for three cashiers is still hiring after one.
        if (dto.close_post_when_filled !== false) {
            const hired = await this.db.jobApplication.count({
                where: { job_post_id: application.job_post_id, stage: 'HIRED' as any, deleted_at: null },
            });
            if (hired >= application.jobPost.openings && application.jobPost.status !== 'FILLED') {
                await this.db.jobPost.update({
                    where: { id: application.job_post_id },
                    data: { status: 'FILLED' as any },
                });
            }
        }

        return this.getApplication(tenantId, id);
    }

    async deleteApplication(tenantId: string, id: string) {
        const application = await this.db.jobApplication.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!application) throw new NotFoundException('Application not found.');
        if (application.hired_employee_id) {
            throw new BadRequestException('A hired application cannot be removed — it is the record of how that employee joined.');
        }

        return this.db.jobApplication.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    /** The numbers the recruitment screens put above their lists. */
    async summary(tenantId: string) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);

        const [openPosts, byStage, hiredThisMonth, openingsAgg] = await Promise.all([
            this.db.jobPost.count({ where: { tenant_id: tenantId, status: 'OPEN' as any, deleted_at: null } }),
            this.db.jobApplication.groupBy({
                by: ['stage'],
                where: { tenant_id: tenantId, deleted_at: null },
                _count: { _all: true },
            }),
            this.db.jobApplication.count({
                where: {
                    tenant_id: tenantId, deleted_at: null, stage: 'HIRED' as any,
                    stage_changed_at: { gte: monthStart },
                },
            }),
            this.db.jobPost.aggregate({
                where: { tenant_id: tenantId, status: 'OPEN' as any, deleted_at: null },
                _sum: { openings: true },
            }),
        ]);

        const stageCounts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<ApplicationStage, number>;
        for (const row of byStage) stageCounts[row.stage as ApplicationStage] = row._count._all;

        return {
            open_posts: openPosts,
            open_openings: openingsAgg._sum.openings ?? 0,
            in_pipeline: RecruitmentService.OPEN_STAGES.reduce((sum, stage) => sum + stageCounts[stage], 0),
            hired_this_month: hiredThisMonth,
            stage_counts: stageCounts,
        };
    }
}
