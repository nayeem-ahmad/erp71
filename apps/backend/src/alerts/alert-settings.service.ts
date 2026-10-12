import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type AlertThresholds = {
    large_sale_amount: number;
    large_refund_amount: number;
    till_shortfall_amount: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
    large_sale_amount: 50000,
    large_refund_amount: 10000,
    till_shortfall_amount: 500,
};

/** The shop-wide alert lines; absent rows read as the defaults. */
@Injectable()
export class AlertSettingsService {
    constructor(private readonly db: DatabaseService) {}

    async forTenants(tenantIds: string[]): Promise<Map<string, AlertThresholds>> {
        const rows = tenantIds.length
            ? await this.db.alertSettings.findMany({ where: { tenant_id: { in: [...new Set(tenantIds)] } } })
            : [];
        const byTenant = new Map(rows.map((row) => [row.tenant_id, toThresholds(row)]));
        return new Map(tenantIds.map((id) => [id, byTenant.get(id) ?? DEFAULT_THRESHOLDS]));
    }

    async get(tenantId: string): Promise<AlertThresholds> {
        return (await this.forTenants([tenantId])).get(tenantId)!;
    }

    /** The lowest line any workspace draws, so a scan can ask the database for less. */
    async lowest(): Promise<AlertThresholds> {
        const rows = await this.db.alertSettings.findMany();
        const min = (key: keyof AlertThresholds) =>
            Math.min(DEFAULT_THRESHOLDS[key], ...rows.map((row) => Number(row[key])));
        return {
            large_sale_amount: min('large_sale_amount'),
            large_refund_amount: min('large_refund_amount'),
            till_shortfall_amount: min('till_shortfall_amount'),
        };
    }

    async update(tenantId: string, values: Partial<AlertThresholds>): Promise<AlertThresholds> {
        const row = await this.db.alertSettings.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...values },
            update: values,
        });
        return toThresholds(row);
    }
}

function toThresholds(row: { large_sale_amount: unknown; large_refund_amount: unknown; till_shortfall_amount: unknown }): AlertThresholds {
    return {
        large_sale_amount: Number(row.large_sale_amount),
        large_refund_amount: Number(row.large_refund_amount),
        till_shortfall_amount: Number(row.till_shortfall_amount),
    };
}
