import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { resolveHourlyCost, salaryDerivedRate, settingsFromRow } from '../common/labour-cost.util';

/**
 * What one hour of an employee costs, for pricing their project hours.
 *
 * Optional per person: without a rate, an hour is priced from the basic
 * salary and the workspace's costing settings. A rate here is effective from
 * its date, so adding a new one never re-prices hours already logged — those
 * keep the rate they were priced at.
 */
@Injectable()
export class EmployeeCostRatesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    async list(tenantId: string, employeeId: string, storeId?: string) {
        const employee = await this.loadEmployee(tenantId, employeeId, storeId);
        const [rates, settingsRow] = await Promise.all([
            this.db.employeeCostRate.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId },
                orderBy: { effective_from: 'desc' },
            }),
            this.db.projectCostingSettings.findUnique({ where: { tenant_id: tenantId } }),
        ]);
        const settings = settingsFromRow(settingsRow);
        const today = new Date();
        const current = resolveHourlyCost(today, rates, employee.basic_salary, settings);
        const derived = salaryDerivedRate(employee.basic_salary, settings);

        return {
            rates: rates.map((rate) => ({
                id: rate.id,
                hourlyCost: Number(rate.hourly_cost),
                effectiveFrom: rate.effective_from.toISOString().slice(0, 10),
                note: rate.note,
                createdAt: rate.created_at,
            })),
            // What an hour logged today would be priced at, and why.
            current: current ? { hourlyCost: Number(current.rate), source: current.source } : null,
            // The salary-derived figure, shown beside an explicit rate so HR can see the gap.
            derivedFromSalary: derived === null ? null : Number(derived),
            settings,
        };
    }

    async create(
        tenantId: string,
        employeeId: string,
        dto: { hourlyCost: number; effectiveFrom: string; note?: string },
        storeId: string | undefined,
        ctx: AuditContext,
    ) {
        await this.loadEmployee(tenantId, employeeId, storeId);
        try {
            const created = await this.db.employeeCostRate.create({
                data: {
                    tenant_id: tenantId,
                    employee_id: employeeId,
                    hourly_cost: dto.hourlyCost,
                    effective_from: new Date(dto.effectiveFrom),
                    note: dto.note?.trim() || null,
                    created_by: ctx.userId ?? null,
                },
            });
            await this.audit
                .log('EMPLOYEE_COST_RATE_SET', 'Employee', { ...ctx, tenantId }, employeeId, {
                    hourly_cost: dto.hourlyCost,
                    effective_from: dto.effectiveFrom,
                })
                .catch(() => {});
            return created;
        } catch (err: any) {
            if (err?.code === 'P2002') {
                throw new ConflictException('This employee already has a rate from that date. Remove it first.');
            }
            throw err;
        }
    }

    async remove(tenantId: string, employeeId: string, rateId: string, storeId: string | undefined, ctx: AuditContext) {
        await this.loadEmployee(tenantId, employeeId, storeId);
        const rate = await this.db.employeeCostRate.findFirst({
            where: { id: rateId, tenant_id: tenantId, employee_id: employeeId },
        });
        if (!rate) throw new NotFoundException('Cost rate not found');
        await this.db.employeeCostRate.delete({ where: { id: rateId } });
        await this.audit
            .log('EMPLOYEE_COST_RATE_REMOVED', 'Employee', { ...ctx, tenantId }, employeeId, {
                hourly_cost: Number(rate.hourly_cost),
                effective_from: rate.effective_from.toISOString().slice(0, 10),
            })
            .catch(() => {});
        return { removed: true };
    }

    private async loadEmployee(tenantId: string, employeeId: string, storeId?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
            select: { id: true, basic_salary: true },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        return employee;
    }
}
