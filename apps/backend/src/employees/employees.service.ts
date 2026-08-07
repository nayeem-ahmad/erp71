import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { CreateEmployeeDto, UpdateEmployeeDto, CreateDepartmentDto, UpdateDepartmentDto, CreateDesignationDto, UpdateDesignationDto } from './employee.dto';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { runImport, ImportResult } from '../common/import.util';
import { TenantContext } from '../database/tenant.decorator';
import { canViewPayroll, stripPayrollFields } from '../common/payroll-visibility';

@Injectable()
export class EmployeesService {
    constructor(
        private db: DatabaseService,
        private encryption: EncryptionService,
    ) {}

    private encryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.encrypt(value);
    }

    private decryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.decrypt(value);
    }

    private decryptEmployee<T extends { nid?: string | null }>(emp: T): T {
        return { ...emp, nid: this.decryptNid(emp.nid) };
    }

    /**
     * Whether `viewer` may see salary figures.
     *
     * `viewer` is optional so the existing `(tenantId, ...)` call shape still
     * compiles, but **omitting it strips the salary** rather than exposing it.
     * The fail-safe direction matters more than the ergonomics here: a call site
     * that forgets to thread the viewer through loses a field visibly, where the
     * opposite default would leak every salary in the tenant silently.
     */
    private canSeeSalary(viewer?: TenantContext): Promise<boolean> {
        if (!viewer) return Promise.resolve(false);
        return canViewPayroll(this.db, viewer);
    }

    private async generateEmployeeCode(tenantId: string): Promise<string> {
        const last = await this.db.employee.findFirst({
            where: { tenant_id: tenantId },
            orderBy: { employee_code: 'desc' },
            select: { employee_code: true },
        });

        if (!last) return 'EMP-00001';
        const match = last.employee_code.match(/EMP-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `EMP-${String(nextNum).padStart(5, '0')}`;
    }

    // ── Departments ───────────────────────────────────────────────────────────

    async listDepartments(tenantId: string) {
        return this.db.department.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
        });
    }

    async createDepartment(tenantId: string, dto: CreateDepartmentDto) {
        const existing = await this.db.department.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null },
        });
        if (existing) throw new ConflictException('A department with this name already exists.');

        return this.db.department.create({
            data: { tenant_id: tenantId, name: dto.name },
        });
    }

    async updateDepartment(tenantId: string, id: string, dto: UpdateDepartmentDto) {
        const dept = await this.db.department.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!dept) throw new NotFoundException('Department not found.');

        const duplicate = await this.db.department.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null, NOT: { id } },
        });
        if (duplicate) throw new ConflictException('A department with this name already exists.');

        return this.db.department.update({ where: { id }, data: { name: dto.name } });
    }

    async deleteDepartment(tenantId: string, id: string) {
        const dept = await this.db.department.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!dept) throw new NotFoundException('Department not found.');

        const assigned = await this.db.employee.count({
            where: { department_id: id, deleted_at: null },
        });
        if (assigned > 0) throw new BadRequestException('Cannot delete a department that has employees assigned to it.');

        return this.db.department.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Designations ──────────────────────────────────────────────────────────

    async listDesignations(tenantId: string) {
        return this.db.designation.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
        });
    }

    async createDesignation(tenantId: string, dto: CreateDesignationDto) {
        const existing = await this.db.designation.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null },
        });
        if (existing) throw new ConflictException('A designation with this name already exists.');

        return this.db.designation.create({
            data: { tenant_id: tenantId, name: dto.name },
        });
    }

    async updateDesignation(tenantId: string, id: string, dto: UpdateDesignationDto) {
        const desig = await this.db.designation.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!desig) throw new NotFoundException('Designation not found.');

        const duplicate = await this.db.designation.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null, NOT: { id } },
        });
        if (duplicate) throw new ConflictException('A designation with this name already exists.');

        return this.db.designation.update({ where: { id }, data: { name: dto.name } });
    }

    async deleteDesignation(tenantId: string, id: string) {
        const desig = await this.db.designation.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!desig) throw new NotFoundException('Designation not found.');

        const assigned = await this.db.employee.count({
            where: { designation_id: id, deleted_at: null },
        });
        if (assigned > 0) throw new BadRequestException('Cannot delete a designation that has employees assigned to it.');

        return this.db.designation.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Employees ─────────────────────────────────────────────────────────────

    async create(tenantId: string, dto: CreateEmployeeDto, viewer?: TenantContext) {
        const existing = await this.db.employee.findFirst({
            where: { tenant_id: tenantId, phone: dto.phone },
        });
        if (existing) throw new BadRequestException('An employee with this phone number already exists.');

        if (dto.department_id) {
            const dept = await this.db.department.findFirst({ where: { id: dto.department_id, tenant_id: tenantId, deleted_at: null } });
            if (!dept) throw new BadRequestException('Department not found.');
        }
        if (dto.designation_id) {
            const desig = await this.db.designation.findFirst({ where: { id: dto.designation_id, tenant_id: tenantId, deleted_at: null } });
            if (!desig) throw new BadRequestException('Designation not found.');
        }

        const employee_code = await this.generateEmployeeCode(tenantId);
        const seesSalary = await this.canSeeSalary(viewer);
        const { nid, basic_salary, ...rest } = dto as CreateEmployeeDto & { basic_salary?: unknown };

        // Same rule as `update`: no VIEW_PAYROLL, no salary written. On create
        // there is nothing to overwrite, so this only drops a figure the caller
        // should not have been able to enter in the first place.
        const salaryPatch = seesSalary && basic_salary !== undefined
            ? { basic_salary: basic_salary as any }
            : {};

        const record = await this.db.employee.create({
            data: {
                tenant_id: tenantId,
                employee_code,
                ...rest,
                ...salaryPatch,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
        });
        return stripPayrollFields(this.decryptEmployee(record), seesSalary);
    }

    async findAll(
        tenantId: string,
        opts?: { page?: number; limit?: number; search?: string; status?: string; departmentId?: string },
        viewer?: TenantContext,
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts?.status) where.status = opts.status;
        if (opts?.departmentId) where.department_id = opts.departmentId;
        if (opts?.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { employee_code: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total, seesSalary] = await Promise.all([
            this.db.employee.findMany({
                where,
                include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.employee.count({ where }),
            this.canSeeSalary(viewer),
        ]);

        return paginate(
            items.map(e => stripPayrollFields(this.decryptEmployee(e), seesSalary)),
            total,
            page,
            limit,
        );
    }

    async findOne(tenantId: string, id: string, viewer?: TenantContext) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        return stripPayrollFields(this.decryptEmployee(employee), await this.canSeeSalary(viewer));
    }

    async update(tenantId: string, id: string, dto: UpdateEmployeeDto, viewer?: TenantContext) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        if (dto.phone && dto.phone !== employee.phone) {
            const duplicate = await this.db.employee.findFirst({
                where: { tenant_id: tenantId, phone: dto.phone, NOT: { id: employee.id } },
            });
            if (duplicate) throw new BadRequestException('An employee with this phone number already exists.');
        }

        if (dto.department_id) {
            const dept = await this.db.department.findFirst({ where: { id: dto.department_id, tenant_id: tenantId, deleted_at: null } });
            if (!dept) throw new BadRequestException('Department not found.');
        }
        if (dto.designation_id) {
            const desig = await this.db.designation.findFirst({ where: { id: dto.designation_id, tenant_id: tenantId, deleted_at: null } });
            if (!desig) throw new BadRequestException('Designation not found.');
        }

        const seesSalary = await this.canSeeSalary(viewer);
        const { nid, basic_salary, ...rest } = dto as UpdateEmployeeDto & { basic_salary?: unknown };

        // A caller who cannot *read* the salary cannot write it either. This is
        // not belt-and-braces: the employee edit form sends `basic_salary` on
        // every save, so without this a VIEW_HR-only user renaming someone
        // would post the stripped field back as `null` and silently wipe a real
        // figure. Dropping it is the graceful outcome — refusing the whole
        // request would make the form unusable for exactly the users who are
        // allowed to use it.
        const salaryPatch = seesSalary && basic_salary !== undefined
            ? { basic_salary: basic_salary as any }
            : {};

        const record = await this.db.employee.update({
            where: { id },
            data: {
                ...rest,
                ...salaryPatch,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
        });
        return stripPayrollFields(this.decryptEmployee(record), seesSalary);
    }

    async remove(tenantId: string, id: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        return this.db.employee.update({
            where: { id },
            data: { deleted_at: new Date(), user_id: null },
        });
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                phone: raw.phone ? String(raw.phone).trim() || null : null,
                email: raw.email ? String(raw.email).trim() || null : null,
                joining_date: raw.joining_date ? String(raw.joining_date).trim() || null : null,
                salary: (() => {
                    if (raw.salary == null || raw.salary === '') return null;
                    const n = Number(raw.salary);
                    return isNaN(n) ? null : n;
                })(),
            }),
            findDuplicate: async (row) => {
                if (!row.phone) return null;
                const existing = await this.db.employee.findFirst({
                    where: { tenant_id: tenantId, phone: row.phone, deleted_at: null },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const employee_code = await this.generateEmployeeCode(tenantId);
                await this.db.employee.create({
                    data: {
                        tenant_id: tenantId,
                        employee_code,
                        name: row.name,
                        phone: row.phone,
                        email: row.email,
                        ...(row.joining_date ? { joining_date: new Date(row.joining_date) } : {}),
                        ...(row.salary != null ? { salary: row.salary } : {}),
                    },
                });
            },
            update: async (id, row) => {
                await this.db.employee.update({
                    where: { id },
                    data: {
                        name: row.name,
                        phone: row.phone ?? undefined,
                        email: row.email ?? undefined,
                        ...(row.joining_date ? { joining_date: new Date(row.joining_date) } : {}),
                        ...(row.salary != null ? { salary: row.salary } : {}),
                    },
                });
            },
        });
    }

    async linkUser(tenantId: string, id: string, userId: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        // Ensure the user belongs to this tenant
        const tenantUser = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, user_id: userId },
        });
        if (!tenantUser) throw new BadRequestException('User does not belong to this tenant.');

        // Ensure the user isn't already linked to another employee
        const alreadyLinked = await this.db.employee.findFirst({
            where: { tenant_id: tenantId, user_id: userId, deleted_at: null },
        });
        if (alreadyLinked && alreadyLinked.id !== id) {
            throw new ConflictException('This user is already linked to another employee.');
        }

        const record = await this.db.employee.update({
            where: { id },
            data: { user_id: userId },
            include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
        });
        return this.decryptEmployee(record);
    }

    async unlinkUser(tenantId: string, id: string) {
        const employee = await this.db.employee.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        const record = await this.db.employee.update({
            where: { id },
            data: { user_id: null },
            include: { department: true, designation: true, user: { select: { id: true, email: true, name: true } } },
        });
        return this.decryptEmployee(record);
    }
}
