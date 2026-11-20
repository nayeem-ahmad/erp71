import { Prisma } from '@prisma/client';

/**
 * The few money rules project financials and the cross-project report must
 * share, so the two never disagree about the same project.
 */

type Money = Prisma.Decimal | number | string | null | undefined;

export const num = (value: Money) => Number(value ?? 0);
export const round2 = (value: number) => Math.round(value * 100) / 100;

/** The order categories are shown in, and the ones a budget can be split by. */
export const BUDGET_CATEGORIES = ['LABOUR', 'MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export interface ProjectSaleRow {
    id: string;
    total_amount: Money;
    vat_amount: Money;
    sd_amount: Money;
}

/**
 * What an invoice earned the business: its total **net of VAT and SD**, which
 * are the state's money, not income.
 */
export const saleNet = (sale: ProjectSaleRow) => num(sale.total_amount) - num(sale.vat_amount) - num(sale.sd_amount);

/**
 * The part of a refund that came out of income rather than tax: the refund at
 * its invoice's own net share, so a return on a 15%-VAT invoice takes back
 * revenue net of that VAT.
 */
export function refundNet(refund: Money, sale: ProjectSaleRow | undefined): number {
    if (!sale) return 0;
    const total = num(sale.total_amount);
    return total > 0 ? num(refund) * (saleNet(sale) / total) : 0;
}

/** Margin as a share of revenue; null while there is no revenue to divide by. */
export const marginPct = (margin: number, revenue: number) => (revenue > 0 ? round2((margin / revenue) * 100) : null);
