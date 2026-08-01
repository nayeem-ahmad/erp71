import { BadRequestException } from '@nestjs/common';
import { AccountType, TOTAL_SCOPE_KEY } from './accounting.constants';
import {
    bucketForAccount,
    mergeCompareAmountsByColumn,
    normalizeReportLevel,
    ReportLevel,
    rollUpByLevel,
    unassignedSubgroupLabel,
    type LevelledAccount,
} from './report-level.utils';

const cashGroup = { id: 'g-assets', name: 'Current Assets', code: '11' };
const expenseGroup = { id: 'g-opex', name: 'Operating Expenses', code: '51' };
const bankSubgroup = { id: 'sg-bank', name: 'Bank Accounts', code: '1101' };
const cashSubgroup = { id: 'sg-cash', name: 'Cash In Hand', code: '1102' };

function account(overrides: Partial<LevelledAccount> & { id: string }): LevelledAccount {
    return {
        name: overrides.id,
        code: null,
        type: AccountType.ASSET,
        group: cashGroup,
        subgroup: null,
        ...overrides,
    };
}

describe('report-level.utils', () => {
    describe('normalizeReportLevel', () => {
        it('defaults to account', () => {
            expect(normalizeReportLevel()).toBe('account');
            expect(normalizeReportLevel(undefined)).toBe('account');
        });

        it('accepts subgroup and group', () => {
            expect(normalizeReportLevel('subgroup')).toBe('subgroup');
            expect(normalizeReportLevel('group')).toBe('group');
        });

        it('rejects an invalid level', () => {
            expect(() => normalizeReportLevel('ledger')).toThrow(BadRequestException);
        });
    });

    describe('bucketForAccount', () => {
        const bankAccount = account({
            id: 'a-1',
            name: 'City Bank',
            code: '110101',
            subgroup: bankSubgroup,
        });

        it('buckets by account at account level', () => {
            const bucket = bucketForAccount(bankAccount, ReportLevel.ACCOUNT);
            expect(bucket).toMatchObject({
                id: 'a-1',
                name: 'City Bank',
                code: '110101',
                is_unassigned: false,
            });
            expect(bucket.subgroup).toEqual(bankSubgroup);
        });

        it('buckets by subgroup at subgroup level, carrying the subgroup code', () => {
            const bucket = bucketForAccount(bankAccount, ReportLevel.SUBGROUP);
            expect(bucket).toMatchObject({
                id: 'sg-bank',
                name: 'Bank Accounts',
                code: '1101',
                is_unassigned: false,
            });
        });

        it('buckets by group at group level, carrying the group code', () => {
            const bucket = bucketForAccount(bankAccount, ReportLevel.GROUP);
            expect(bucket).toMatchObject({
                id: 'g-assets',
                name: 'Current Assets',
                code: '11',
                subgroup: null,
            });
        });

        it('routes accounts without a subgroup into a per-group unassigned bucket', () => {
            const orphan = account({ id: 'a-2', name: 'Petty Cash', subgroup: null });
            const bucket = bucketForAccount(orphan, ReportLevel.SUBGROUP);

            expect(bucket.is_unassigned).toBe(true);
            expect(bucket.name).toBe(unassignedSubgroupLabel('Current Assets'));
            expect(bucket.id).toBe('g-assets:__none__');
            // The reserved slot accounts hanging off the group are coded into.
            expect(bucket.code).toBe('1100');
        });

        it('keeps unassigned buckets of different groups apart', () => {
            const assetOrphan = account({ id: 'a-3', subgroup: null });
            const expenseOrphan = account({
                id: 'a-4',
                type: AccountType.EXPENSE,
                group: expenseGroup,
                subgroup: null,
            });

            expect(bucketForAccount(assetOrphan, ReportLevel.SUBGROUP).key)
                .not.toBe(bucketForAccount(expenseOrphan, ReportLevel.SUBGROUP).key);
        });

        it('splits a mixed-type group into one bucket per account type', () => {
            const asset = account({ id: 'a-5', type: AccountType.ASSET, group: cashGroup });
            const expense = account({ id: 'a-6', type: AccountType.EXPENSE, group: cashGroup });

            expect(bucketForAccount(asset, ReportLevel.GROUP).key)
                .not.toBe(bucketForAccount(expense, ReportLevel.GROUP).key);
        });
    });

    describe('rollUpByLevel', () => {
        const sum = (a: { value: number }, b: { value: number }) => ({ value: a.value + b.value });

        const items = [
            { account: account({ id: 'a-1', name: 'City Bank', code: '110101', subgroup: bankSubgroup }), payload: { value: 100 } },
            { account: account({ id: 'a-2', name: 'Brac Bank', code: '110102', subgroup: bankSubgroup }), payload: { value: 250 } },
            { account: account({ id: 'a-3', name: 'Cash Register', code: '110201', subgroup: cashSubgroup }), payload: { value: 40 } },
            { account: account({ id: 'a-4', name: 'Petty Cash', code: '110001', subgroup: null }), payload: { value: 10 } },
        ];

        it('is a code-ordered identity at account level', () => {
            const rolled = rollUpByLevel(items, ReportLevel.ACCOUNT, sum);

            expect(rolled).toHaveLength(4);
            expect(rolled.map((entry) => entry.bucket.id)).toEqual(['a-4', 'a-1', 'a-2', 'a-3']);
            expect(rolled.map((entry) => entry.payload.value)).toEqual([10, 100, 250, 40]);
        });

        it('merges accounts sharing a subgroup', () => {
            const rolled = rollUpByLevel(items, ReportLevel.SUBGROUP, sum);

            expect(rolled).toHaveLength(3);
            expect(rolled.map((entry) => entry.bucket.name)).toEqual([
                'Bank Accounts',
                'Cash In Hand',
                unassignedSubgroupLabel('Current Assets'),
            ]);
            expect(rolled.map((entry) => entry.payload.value)).toEqual([350, 40, 10]);
        });

        it('merges every account of a group at group level', () => {
            const rolled = rollUpByLevel(items, ReportLevel.GROUP, sum);

            expect(rolled).toHaveLength(1);
            expect(rolled[0].bucket.name).toBe('Current Assets');
            expect(rolled[0].payload.value).toBe(400);
        });

        it('preserves the grand total at every level', () => {
            const total = (level: ReportLevel) => rollUpByLevel(items, level, sum)
                .reduce((acc, entry) => acc + entry.payload.value, 0);

            expect(total(ReportLevel.ACCOUNT)).toBe(400);
            expect(total(ReportLevel.SUBGROUP)).toBe(400);
            expect(total(ReportLevel.GROUP)).toBe(400);
        });

        it('sorts rolled-up buckets by group then name, unassigned last', () => {
            const mixed = [
                { account: account({ id: 'a-9', type: AccountType.EXPENSE, group: expenseGroup, subgroup: null }), payload: { value: 5 } },
                { account: account({ id: 'a-8', subgroup: null }), payload: { value: 5 } },
                { account: account({ id: 'a-7', subgroup: cashSubgroup }), payload: { value: 5 } },
            ];

            expect(rollUpByLevel(mixed, ReportLevel.SUBGROUP, sum).map((entry) => entry.bucket.name)).toEqual([
                'Cash In Hand',
                unassignedSubgroupLabel('Current Assets'),
                unassignedSubgroupLabel('Operating Expenses'),
            ]);
        });

        it('does not mutate caller payloads while merging', () => {
            const first = { value: 100 };
            const rolled = rollUpByLevel(
                [
                    { account: account({ id: 'a-1', subgroup: bankSubgroup }), payload: first },
                    { account: account({ id: 'a-2', subgroup: bankSubgroup }), payload: { value: 20 } },
                ],
                ReportLevel.SUBGROUP,
                sum,
            );

            expect(first.value).toBe(100);
            expect(rolled[0].payload.value).toBe(120);
        });
    });

    describe('mergeCompareAmountsByColumn', () => {
        const columnKeys = ['store-a', 'store-b', TOTAL_SCOPE_KEY];

        it('adds per column and recomputes the total column', () => {
            const merged = mergeCompareAmountsByColumn(
                { 'store-a': 100, 'store-b': 50, [TOTAL_SCOPE_KEY]: 150 },
                { 'store-a': 25, 'store-b': 5, [TOTAL_SCOPE_KEY]: 30 },
                columnKeys,
            );

            expect(merged).toEqual({ 'store-a': 125, 'store-b': 55, [TOTAL_SCOPE_KEY]: 180 });
        });

        it('never carries a stale total forward', () => {
            const merged = mergeCompareAmountsByColumn(
                { 'store-a': 10, 'store-b': 0, [TOTAL_SCOPE_KEY]: 999 },
                { 'store-a': 10, 'store-b': 0, [TOTAL_SCOPE_KEY]: 999 },
                columnKeys,
            );

            expect(merged[TOTAL_SCOPE_KEY]).toBe(20);
        });

        it('rounds to two decimals', () => {
            const merged = mergeCompareAmountsByColumn(
                { 'store-a': 0.1, 'store-b': 0, [TOTAL_SCOPE_KEY]: 0.1 },
                { 'store-a': 0.2, 'store-b': 0, [TOTAL_SCOPE_KEY]: 0.2 },
                columnKeys,
            );

            expect(merged['store-a']).toBe(0.3);
        });
    });
});
