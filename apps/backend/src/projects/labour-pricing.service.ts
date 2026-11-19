import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
    type CostingSettings,
    type HourlyCost,
    costColumns,
    resolveHourlyCost,
    settingsFromRow,
} from '../common/labour-cost.util';

type Hours = Prisma.Decimal | number | string;

/**
 * Prices project hours at the moment they are written.
 *
 * Every write path — a typed entry, an import row, a stopped timer, an edit
 * that changes the hours or the day — goes through here, so an entry's cost is
 * always the rate in force for its person on its day, captured then. Reading
 * a project's financials therefore only sums; it never re-prices history.
 */
@Injectable()
export class LabourPricingService {
    constructor(private readonly db: DatabaseService) {}

    async settings(tenantId: string): Promise<CostingSettings> {
        const row = await this.db.projectCostingSettings.findUnique({ where: { tenant_id: tenantId } });
        return settingsFromRow(row);
    }

    /** What an hour of this employee cost on this day; null when nothing prices it. */
    async hourlyCost(tenantId: string, employeeId: string | null, workDate: Date): Promise<HourlyCost | null> {
        if (!employeeId) return null;
        const [employee, rates, settings] = await Promise.all([
            this.db.employee.findFirst({
                where: { id: employeeId, tenant_id: tenantId },
                select: { basic_salary: true },
            }),
            this.db.employeeCostRate.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, effective_from: { lte: workDate } },
                select: { hourly_cost: true, effective_from: true },
            }),
            this.settings(tenantId),
        ]);
        if (!employee) return null;
        return resolveHourlyCost(workDate, rates, employee.basic_salary, settings);
    }

    /** The cost columns for a new or re-dated entry. All null for an uncosted hour. */
    async price(tenantId: string, employeeId: string | null, workDate: Date, hours: Hours) {
        return costColumns(hours, await this.hourlyCost(tenantId, employeeId, workDate));
    }

    /**
     * Price many entries at once — the "price these hours" action on a
     * project's financials. One read of each person's salary and rates, not
     * one per entry.
     */
    async priceMany(
        tenantId: string,
        entries: ReadonlyArray<{ id: string; employee_id: string | null; work_date: Date; hours: Hours }>,
    ): Promise<Map<string, ReturnType<typeof costColumns>>> {
        const employeeIds = [...new Set(entries.map((entry) => entry.employee_id).filter((id): id is string => !!id))];
        const result = new Map<string, ReturnType<typeof costColumns>>();
        if (employeeIds.length === 0) return result;

        const [employees, rates, settings] = await Promise.all([
            this.db.employee.findMany({
                where: { tenant_id: tenantId, id: { in: employeeIds } },
                select: { id: true, basic_salary: true },
            }),
            this.db.employeeCostRate.findMany({
                where: { tenant_id: tenantId, employee_id: { in: employeeIds } },
                select: { employee_id: true, hourly_cost: true, effective_from: true },
            }),
            this.settings(tenantId),
        ]);
        const salaryOf = new Map(employees.map((row) => [row.id, row.basic_salary]));
        const ratesOf = new Map<string, typeof rates>();
        for (const row of rates) {
            const list = ratesOf.get(row.employee_id) ?? [];
            list.push(row);
            ratesOf.set(row.employee_id, list);
        }

        for (const entry of entries) {
            if (!entry.employee_id || !salaryOf.has(entry.employee_id)) continue;
            const cost = resolveHourlyCost(
                entry.work_date,
                ratesOf.get(entry.employee_id) ?? [],
                salaryOf.get(entry.employee_id),
                settings,
            );
            if (cost) result.set(entry.id, costColumns(entry.hours, cost));
        }
        return result;
    }
}
