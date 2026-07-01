import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountType } from './accounting.constants';
import { COMPANY_SCOPE_KEY, ReportScope, TOTAL_SCOPE_KEY } from './accounting.constants';

export type ReportScopeQuery = {
    scope?: string;
    storeId?: string;
    storeIds?: string[];
    includeCompanyBucket?: boolean;
};

export type CompareColumn = {
    key: string;
    label: string;
    type: 'branch' | 'company' | 'total';
};

export type CompareAmounts = Record<string, number>;

export function normalizeReportScope(scope?: string): string {
    if (!scope || scope === ReportScope.COMPANY) {
        return ReportScope.COMPANY;
    }
    if (scope === ReportScope.BRANCH || scope === ReportScope.COMPARE) {
        return scope;
    }
    throw new BadRequestException(`Invalid report scope: ${scope}`);
}

export function assertReportScopeQuery(query: ReportScopeQuery): {
    scope: string;
    storeId?: string;
    storeIds: string[];
    includeCompanyBucket: boolean;
} {
    const scope = normalizeReportScope(query.scope);
    const includeCompanyBucket = query.includeCompanyBucket !== false;

    if (scope === ReportScope.BRANCH) {
        if (!query.storeId) {
            throw new BadRequestException('storeId is required when scope is branch.');
        }
        return { scope, storeId: query.storeId, storeIds: [], includeCompanyBucket };
    }

    if (scope === ReportScope.COMPARE) {
        const storeIds = (query.storeIds ?? []).filter(Boolean);
        if (storeIds.length < 1) {
            throw new BadRequestException('At least one storeId is required when scope is compare.');
        }
        return { scope, storeIds, includeCompanyBucket };
    }

    return { scope, storeIds: [], includeCompanyBucket };
}

export function assertConsolidatedScopePermission(
    scope: string,
    hasConsolidatedPermission: boolean,
): void {
    if (scope !== ReportScope.BRANCH && !hasConsolidatedPermission) {
        throw new ForbiddenException('VIEW_CONSOLIDATED_REPORTS permission required for this report scope.');
    }
}

export function buildVoucherWhereForScope(
    tenantId: string,
    scope: string,
    storeId?: string,
): Prisma.VoucherWhereInput {
    const base: Prisma.VoucherWhereInput = { tenant_id: tenantId };

    if (scope === ReportScope.BRANCH && storeId) {
        return { ...base, store_id: storeId };
    }

    return base;
}

export function parseStoreIdsParam(storeIds?: string): string[] {
    if (!storeIds) {
        return [];
    }
    return storeIds.split(',').map((id) => id.trim()).filter(Boolean);
}

export function buildCompareVoucherWhere(
    tenantId: string,
    storeIds: string[],
    includeCompanyBucket: boolean,
): Prisma.VoucherWhereInput {
    const base: Prisma.VoucherWhereInput = { tenant_id: tenantId };

    if (includeCompanyBucket) {
        return {
            ...base,
            OR: [
                { store_id: { in: storeIds } },
                { store_id: null },
            ],
        };
    }

    return {
        ...base,
        store_id: { in: storeIds },
    };
}

export function voucherStoreKey(storeId: string | null | undefined): string {
    return storeId ?? COMPANY_SCOPE_KEY;
}

export function roundReportAmount(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function plBalanceForType(
    type: string,
    debit: number,
    credit: number,
): number {
    if (type === AccountType.REVENUE) {
        return roundReportAmount(credit - debit);
    }
    return roundReportAmount(debit - credit);
}

export function bsSignedBalance(
    type: string,
    debit: number,
    credit: number,
): number {
    if (type === AccountType.ASSET || type === AccountType.EXPENSE) {
        return roundReportAmount(debit - credit);
    }
    return roundReportAmount(credit - debit);
}

export function buildCompareColumns(
    stores: { id: string; name: string }[],
    includeCompanyBucket: boolean,
): CompareColumn[] {
    const columns: CompareColumn[] = stores.map((store) => ({
        key: store.id,
        label: store.name,
        type: 'branch',
    }));

    if (includeCompanyBucket) {
        columns.push({ key: COMPANY_SCOPE_KEY, label: 'Company', type: 'company' });
    }

    columns.push({ key: TOTAL_SCOPE_KEY, label: 'Total', type: 'total' });
    return columns;
}

export function initCompareAmounts(columnKeys: string[]): CompareAmounts {
    return Object.fromEntries(columnKeys.map((key) => [key, 0]));
}

export function sumCompareAmounts(amounts: CompareAmounts, columnKeys: string[]): number {
    return roundReportAmount(
        columnKeys
            .filter((key) => key !== TOTAL_SCOPE_KEY)
            .reduce((sum, key) => sum + (amounts[key] ?? 0), 0),
    );
}

export function finalizeCompareAmounts(amounts: CompareAmounts, columnKeys: string[]): CompareAmounts {
    const next = { ...amounts };
    next[TOTAL_SCOPE_KEY] = sumCompareAmounts(next, columnKeys);
    return next;
}

export type VoucherDetailWithStore = {
    account_id: string;
    debit_amount: Prisma.Decimal | number | null;
    credit_amount: Prisma.Decimal | number | null;
    voucher: { store_id: string | null };
};

export function aggregateDetailsByStore(
    details: VoucherDetailWithStore[],
): Map<string, Map<string, { debit: number; credit: number }>> {
    const byStore = new Map<string, Map<string, { debit: number; credit: number }>>();

    for (const detail of details) {
        const storeKey = voucherStoreKey(detail.voucher.store_id);
        const accountMap = byStore.get(storeKey) ?? new Map<string, { debit: number; credit: number }>();
        const existing = accountMap.get(detail.account_id) ?? { debit: 0, credit: 0 };
        existing.debit += Number(detail.debit_amount ?? 0);
        existing.credit += Number(detail.credit_amount ?? 0);
        accountMap.set(detail.account_id, existing);
        byStore.set(storeKey, accountMap);
    }

    return byStore;
}