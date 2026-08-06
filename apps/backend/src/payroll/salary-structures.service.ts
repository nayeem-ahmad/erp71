import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import {
    ComponentDef,
    DEFAULT_COMPONENTS,
    DEFAULT_RATES,
    computeStructure,
    structureInForce,
} from './salary-structure.util';

/**
 * Salary components, per-employee structures and bank details — HRIS Phase 5.
 *
 * The point of this phase is that gross pay becomes *composed* rather than
 * typed. `Employee.basic_salary` stays as the fallback for anyone without a
 * structure; it is deliberately not dropped, because a tenant that never opens
 * this screen must keep being payable.
 */
@Injectable()
export class SalaryStructuresService {
    constructor(
        private readonly db: DatabaseService,
        private readonly encryption: EncryptionService,
    ) {}

    private toDateOnly(value: string | Date): Date {
        const date = value instanceof Date ? value : new Date(value);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    // ── Components ────────────────────────────────────────────────────────────

    async listComponents(tenantId: string) {
        return this.db.salaryComponent.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
    }

    /**
     * Seed the standard Bangladeshi split if the tenant has none.
     *
     * Idempotent on *any* component existing, not on a basic one: a tenant that
     * deliberately deleted the seeded set must not have it grow back.
     */
    async ensureDefaultComponents(tenantId: string) {
        const existing = await this.db.salaryComponent.count({
            where: { tenant_id: tenantId, deleted_at: null },
        });
        if (existing > 0) return { created: 0 };

        await this.db.salaryComponent.createMany({
            data: DEFAULT_COMPONENTS.map((component) => ({ tenant_id: tenantId, ...component })),
            skipDuplicates: true,
        });
        return { created: DEFAULT_COMPONENTS.length };
    }

    async createComponent(tenantId: string, dto: {
        name: string; kind: string; calculation?: string;
        is_taxable?: boolean; is_basic?: boolean; sort_order?: number;
    }) {
        const duplicate = await this.db.salaryComponent.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null },
        });
        if (duplicate) throw new ConflictException('A salary component with this name already exists.');

        if (dto.is_basic) {
            if (dto.kind !== 'EARNING') {
                throw new BadRequestException('The basic component must be an earning.');
            }
            if (dto.calculation === 'PERCENT_OF_BASIC') {
                // A percentage of itself is not a definition; allowing it would
                // make the whole structure circular.
                throw new BadRequestException('The basic component cannot be a percentage of itself.');
            }
            await this.clearBasic(tenantId);
        }

        return this.db.salaryComponent.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                kind: dto.kind,
                calculation: dto.calculation ?? 'FIXED',
                is_taxable: dto.is_taxable ?? true,
                is_basic: dto.is_basic ?? false,
                sort_order: dto.sort_order ?? 0,
            },
        });
    }

    async updateComponent(tenantId: string, id: string, dto: Record<string, any>) {
        const component = await this.db.salaryComponent.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!component) throw new NotFoundException('Salary component not found.');

        if (dto.name && dto.name !== component.name) {
            const clash = await this.db.salaryComponent.findFirst({
                where: { tenant_id: tenantId, name: dto.name, deleted_at: null, NOT: { id } },
            });
            if (clash) throw new ConflictException('A salary component with this name already exists.');
        }

        if (dto.is_basic) {
            if ((dto.calculation ?? component.calculation) === 'PERCENT_OF_BASIC') {
                throw new BadRequestException('The basic component cannot be a percentage of itself.');
            }
            await this.clearBasic(tenantId, id);
        }

        return this.db.salaryComponent.update({ where: { id }, data: dto });
    }

    /** Exactly one basic per tenant, enforced here rather than by a partial index. */
    private async clearBasic(tenantId: string, exceptId?: string) {
        await this.db.salaryComponent.updateMany({
            where: {
                tenant_id: tenantId, is_basic: true,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
            },
            data: { is_basic: false },
        });
    }

    async deleteComponent(tenantId: string, id: string) {
        const component = await this.db.salaryComponent.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!component) throw new NotFoundException('Salary component not found.');
        if (component.is_basic) {
            throw new BadRequestException('The basic component cannot be deleted. Make another one basic first.');
        }

        // Soft delete: structures written against it must keep computing.
        // `computeStructure` skips a line whose component is gone, which is why
        // this does not have to cascade.
        return this.db.salaryComponent.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Structures ────────────────────────────────────────────────────────────

    async listStructures(tenantId: string, employeeId: string) {
        return this.db.employeeSalaryStructure.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId },
            include: { lines: true },
            orderBy: { effective_from: 'desc' },
        });
    }

    async setStructure(tenantId: string, dto: {
        employee_id: string;
        effective_from: string;
        note?: string;
        lines: { component_id: string; value: number }[];
    }, createdBy?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const components = await this.listComponents(tenantId);
        const valid = new Set(components.map((component) => component.id));
        for (const line of dto.lines) {
            if (!valid.has(line.component_id)) {
                throw new BadRequestException('A salary line references a component that does not exist.');
            }
            if (Number(line.value) < 0) {
                throw new BadRequestException('A salary line cannot be negative.');
            }
        }

        const basic = components.find((component) => component.is_basic);
        if (basic && !dto.lines.some((line) => line.component_id === basic.id)) {
            // Without a basic line every percentage line computes to zero, so
            // the structure would look complete and pay almost nothing.
            throw new BadRequestException('A salary structure must include the basic component.');
        }

        const effective_from = this.toDateOnly(dto.effective_from);

        // Replacing a structure on a date it already has is a correction, not a
        // second revision — so the lines are rewritten rather than added to.
        return this.db.$transaction(async (tx) => {
            const existing = await tx.employeeSalaryStructure.findFirst({
                where: { tenant_id: tenantId, employee_id: dto.employee_id, effective_from },
            });
            if (existing) {
                await tx.employeeSalaryStructureLine.deleteMany({ where: { structure_id: existing.id } });
                await tx.employeeSalaryStructureLine.createMany({
                    data: dto.lines.map((line) => ({ structure_id: existing.id, ...line })),
                });
                return tx.employeeSalaryStructure.update({
                    where: { id: existing.id },
                    data: { note: dto.note ?? null },
                    include: { lines: true },
                });
            }

            return tx.employeeSalaryStructure.create({
                data: {
                    tenant_id: tenantId,
                    employee_id: dto.employee_id,
                    effective_from,
                    note: dto.note ?? null,
                    created_by: createdBy ?? null,
                    lines: { create: dto.lines },
                },
                include: { lines: true },
            });
        });
    }

    /**
     * What an employee's pay is composed of on a date.
     *
     * Falls back to a single synthetic basic line from `Employee.basic_salary`
     * when there is no structure. That fallback is the reason this phase does
     * not break every tenant that has not opened the new screen — and it is
     * why `basic_salary` was not dropped.
     */
    async resolveStructure(tenantId: string, employeeId: string, date: Date) {
        const [structures, components, employee] = await Promise.all([
            this.db.employeeSalaryStructure.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId },
                include: { lines: true },
                orderBy: { effective_from: 'desc' },
            }),
            this.listComponents(tenantId),
            this.db.employee.findFirst({
                where: { id: employeeId, tenant_id: tenantId },
                select: { basic_salary: true },
            }),
        ]);

        const inForce = structureInForce(structures, this.toDateOnly(date));
        const defs = components as unknown as ComponentDef[];

        if (inForce) {
            return {
                source: 'STRUCTURE' as const,
                effective_from: inForce.effective_from,
                ...computeStructure(
                    defs,
                    inForce.lines.map((line) => ({
                        component_id: line.component_id,
                        value: Number(line.value),
                    })),
                ),
            };
        }

        const basicComponent = defs.find((component) => component.is_basic);
        const fallbackAmount = Number(employee?.basic_salary ?? 0);
        if (!basicComponent) {
            // No components configured at all — treat the whole salary as one
            // untitled earning rather than returning zero.
            return {
                source: 'BASIC_SALARY' as const,
                effective_from: null,
                basic: fallbackAmount,
                earnings: [],
                deductions: [],
                grossEarnings: fallbackAmount,
                totalDeductions: 0,
                net: fallbackAmount,
                taxableEarnings: fallbackAmount,
            };
        }

        return {
            source: 'BASIC_SALARY' as const,
            effective_from: null,
            ...computeStructure(defs, [{ component_id: basicComponent.id, value: fallbackAmount }]),
        };
    }

    // ── Bank details ──────────────────────────────────────────────────────────

    private encrypt(value?: string | null) {
        return value == null ? undefined : this.encryption.encrypt(value);
    }

    private decrypt(value?: string | null) {
        return value == null ? null : this.encryption.decrypt(value);
    }

    async getBankAccount(tenantId: string, employeeId: string) {
        const account = await this.db.employeeBankAccount.findFirst({
            where: { tenant_id: tenantId, employee_id: employeeId },
        });
        if (!account) return null;
        return {
            ...account,
            account_number: this.decrypt(account.account_number),
            wallet_number: this.decrypt(account.wallet_number),
        };
    }

    async setBankAccount(tenantId: string, employeeId: string, dto: {
        method: string;
        bank_name?: string; branch_name?: string; account_number?: string;
        account_name?: string; routing_number?: string; wallet_number?: string;
    }) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        if (dto.method === 'BANK' && !dto.account_number) {
            throw new BadRequestException('A bank account number is required for bank payment.');
        }
        if ((dto.method === 'BKASH' || dto.method === 'NAGAD') && !dto.wallet_number) {
            throw new BadRequestException('A wallet number is required for mobile money payment.');
        }

        const data = {
            method: dto.method,
            bank_name: dto.bank_name ?? null,
            branch_name: dto.branch_name ?? null,
            account_name: dto.account_name ?? null,
            routing_number: dto.routing_number ?? null,
            account_number: this.encrypt(dto.account_number) ?? null,
            wallet_number: this.encrypt(dto.wallet_number) ?? null,
        };

        const saved = await this.db.employeeBankAccount.upsert({
            where: { employee_id: employeeId },
            create: { tenant_id: tenantId, employee_id: employeeId, ...data },
            update: data,
        });

        return {
            ...saved,
            account_number: this.decrypt(saved.account_number),
            wallet_number: this.decrypt(saved.wallet_number),
        };
    }
}
