import { DatabaseService } from '../database/database.service';

export type ConvertedLeadRef = {
    id: string;
    converted_customer_id: string | null;
    closed_at: Date | null;
};

export type LeadRevenue = {
    orders: number;
    revenue: number;
};

const CHUNK_SIZE = 5000;

export async function revenueByConvertedLead(
    db: Pick<DatabaseService, 'sale'>,
    tenantId: string,
    leads: ConvertedLeadRef[],
    saleWindow?: { fromDate: Date; toDate: Date },
): Promise<Map<string, LeadRevenue>> {
    const customerToLead = new Map<string, { leadId: string; closed_at: Date | null }>();

    for (const lead of leads) {
        if (!lead.converted_customer_id) continue;

        const existing = customerToLead.get(lead.converted_customer_id);
        if (!existing) {
            customerToLead.set(lead.converted_customer_id, {
                leadId: lead.id,
                closed_at: lead.closed_at,
            });
        } else {
            const existingTime = existing.closed_at ? existing.closed_at.getTime() : Infinity;
            const currentTime = lead.closed_at ? lead.closed_at.getTime() : Infinity;
            if (currentTime < existingTime) {
                customerToLead.set(lead.converted_customer_id, {
                    leadId: lead.id,
                    closed_at: lead.closed_at,
                });
            }
        }
    }

    if (customerToLead.size === 0) {
        return new Map<string, LeadRevenue>();
    }

    const customerIds = Array.from(customerToLead.keys());
    const result = new Map<string, LeadRevenue>();

    for (let i = 0; i < customerIds.length; i += CHUNK_SIZE) {
        const chunk = customerIds.slice(i, i + CHUNK_SIZE);

        const where: any = {
            tenant_id: tenantId,
            status: 'COMPLETED',
            customer_id: { in: chunk },
        };

        if (saleWindow) {
            where.sale_date = {
                gte: saleWindow.fromDate,
                lte: saleWindow.toDate,
            };
        }

        const sales = await db.sale.findMany({
            where,
            select: {
                customer_id: true,
                sale_date: true,
                total_amount: true,
            },
        });

        for (const sale of sales) {
            if (!sale.customer_id) continue;
            const owning = customerToLead.get(sale.customer_id);
            if (!owning) continue;

            if (owning.closed_at && sale.sale_date < owning.closed_at) {
                continue;
            }

            const current = result.get(owning.leadId) ?? { orders: 0, revenue: 0 };
            current.orders += 1;
            current.revenue += Number(sale.total_amount);
            result.set(owning.leadId, current);
        }
    }

    return result;
}
