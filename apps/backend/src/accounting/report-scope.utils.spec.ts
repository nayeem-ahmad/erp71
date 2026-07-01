import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountType } from './accounting.constants';
import {
    assertConsolidatedScopePermission,
    assertReportScopeQuery,
    buildCompareColumns,
    buildVoucherWhereForScope,
    finalizeCompareAmounts,
    normalizeReportScope,
    plBalanceForType,
    voucherStoreKey,
} from './report-scope.utils';

describe('report-scope.utils', () => {
    describe('normalizeReportScope', () => {
        it('defaults to company', () => {
            expect(normalizeReportScope()).toBe('company');
        });

        it('accepts branch and compare', () => {
            expect(normalizeReportScope('branch')).toBe('branch');
            expect(normalizeReportScope('compare')).toBe('compare');
        });

        it('rejects invalid scope', () => {
            expect(() => normalizeReportScope('invalid')).toThrow(BadRequestException);
        });
    });

    describe('assertReportScopeQuery', () => {
        it('requires storeId for branch scope', () => {
            expect(() => assertReportScopeQuery({ scope: 'branch' })).toThrow(BadRequestException);
        });

        it('requires storeIds for compare scope', () => {
            expect(() => assertReportScopeQuery({ scope: 'compare', storeIds: [] })).toThrow(BadRequestException);
        });

        it('parses branch scope', () => {
            expect(assertReportScopeQuery({ scope: 'branch', storeId: 's1' })).toEqual({
                scope: 'branch',
                storeId: 's1',
                storeIds: [],
                includeCompanyBucket: true,
            });
        });
    });

    describe('assertConsolidatedScopePermission', () => {
        it('allows branch scope without consolidated permission', () => {
            expect(() => assertConsolidatedScopePermission('branch', false)).not.toThrow();
        });

        it('blocks company scope without consolidated permission', () => {
            expect(() => assertConsolidatedScopePermission('company', false)).toThrow(ForbiddenException);
        });
    });

    describe('buildVoucherWhereForScope', () => {
        it('filters by store for branch scope', () => {
            expect(buildVoucherWhereForScope('t1', 'branch', 's1')).toEqual({
                tenant_id: 't1',
                store_id: 's1',
            });
        });

        it('does not filter store for company scope', () => {
            expect(buildVoucherWhereForScope('t1', 'company')).toEqual({ tenant_id: 't1' });
        });
    });

    describe('voucherStoreKey', () => {
        it('maps null store to company key', () => {
            expect(voucherStoreKey(null)).toBe('company');
        });
    });

    describe('plBalanceForType', () => {
        it('computes revenue as credit minus debit', () => {
            expect(plBalanceForType(AccountType.REVENUE, 10, 100)).toBe(90);
        });
    });

    describe('buildCompareColumns', () => {
        it('adds company and total columns', () => {
            const columns = buildCompareColumns([{ id: 's1', name: 'Gulshan' }], true);
            expect(columns.map((c) => c.key)).toEqual(['s1', 'company', 'total']);
        });
    });

    describe('finalizeCompareAmounts', () => {
        it('sums branch columns into total', () => {
            const result = finalizeCompareAmounts(
                { s1: 100, s2: 50, company: 20, total: 0 },
                ['s1', 's2', 'company', 'total'],
            );
            expect(result.total).toBe(170);
        });
    });
});