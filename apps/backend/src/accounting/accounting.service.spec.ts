import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService, VOUCHER_NUMBER_PREFIXES } from './accounting.service';
import { AccountCategory, AccountType, VoucherType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

describe('AccountingService — Story 30.2', () => {
    let service: AccountingService;

    const db = {
        accountGroup: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        accountSubgroup: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        account: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        voucherSequence: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
        },
        voucher: {
            count: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        voucherDetail: {
            aggregate: jest.fn(),
            findMany: jest.fn(),
        },
        postingRule: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        postingEvent: {
            count: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        $transaction: jest.fn(),
    };

    beforeEach(async () => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation(async (callback: any) => callback(db));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                {
                    provide: DatabaseService,
                    useValue: db,
                },
                {
                    provide: AuditService,
                    useValue: { log: jest.fn().mockResolvedValue(undefined) },
                },
            ],
        }).compile();

        service = module.get(AccountingService);
    });

    it('creates account groups with tenant-scoped uniqueness', async () => {
        db.accountGroup.findUnique.mockResolvedValue(null);
        db.accountGroup.create.mockResolvedValue({ id: 'group-1', name: 'Current Assets', type: 'asset' });

        const result = await service.createAccountGroup('tenant-1', {
            name: 'Current Assets',
            type: AccountType.ASSET,
        });

        expect(result.name).toBe('Current Assets');
        expect(db.accountGroup.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 'tenant-1',
                name: 'Current Assets',
                type: 'asset',
            },
        });
    });

    it('rejects duplicate account groups', async () => {
        db.accountGroup.findUnique.mockResolvedValue({ id: 'group-1' });

        await expect(
            service.createAccountGroup('tenant-1', {
                name: 'Current Assets',
                type: AccountType.ASSET,
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('requires subgroups to belong to the current tenant group', async () => {
        db.accountGroup.findFirst.mockResolvedValue({ id: 'group-1', tenant_id: 'tenant-1' });
        db.accountSubgroup.findUnique.mockResolvedValue(null);
        db.accountSubgroup.create.mockResolvedValue({ id: 'subgroup-1', name: 'Cash and Bank', group: { id: 'group-1' } });

        const result = await service.createAccountSubgroup('tenant-1', {
            groupId: 'group-1',
            name: 'Cash and Bank',
        });

        expect(result.id).toBe('subgroup-1');
        expect(db.accountSubgroup.create).toHaveBeenCalled();
    });

    it('creates accounts only when group type and subgroup integrity match', async () => {
        db.accountGroup.findFirst.mockResolvedValue({ id: 'group-1', tenant_id: 'tenant-1', type: 'asset' });
        db.accountSubgroup.findFirst.mockResolvedValue({ id: 'subgroup-1', tenant_id: 'tenant-1', group_id: 'group-1' });
        db.account.findUnique.mockResolvedValue(null);
        db.account.create.mockResolvedValue({ id: 'account-1', name: 'Cash in Hand', category: 'cash' });

        const result = await service.createAccount('tenant-1', {
            groupId: 'group-1',
            subgroupId: 'subgroup-1',
            name: 'Cash in Hand',
            code: '1010',
            type: AccountType.ASSET,
            category: AccountCategory.CASH,
        });

        expect(result.name).toBe('Cash in Hand');
        expect(db.account.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 'tenant-1',
                group_id: 'group-1',
                subgroup_id: 'subgroup-1',
                name: 'Cash in Hand',
                code: '1010',
                type: 'asset',
                category: 'cash',
            },
            include: {
                group: true,
                subgroup: true,
            },
        });
    });

    it('filters accounts by tenant, group, type, category, and search', async () => {
        db.account.findMany.mockResolvedValue([{ id: 'account-1', name: 'Cash in Hand' }]);

        await service.findAccounts('tenant-1', {
            search: 'cash',
            groupId: 'group-1',
            type: AccountType.ASSET,
            category: AccountCategory.CASH,
        });

        expect(db.account.findMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                group_id: 'group-1',
                type: 'asset',
                category: 'cash',
                OR: [
                    { name: { contains: 'cash', mode: 'insensitive' } },
                    { code: { contains: 'cash', mode: 'insensitive' } },
                ],
            },
            include: {
                group: true,
                subgroup: true,
            },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
    });

    it('previews voucher numbers without consuming the sequence', async () => {
        db.voucherSequence.findUnique.mockResolvedValue(null);

        const result = await service.getVoucherNumberPreview('tenant-1', VoucherType.CASH_PAYMENT);

        expect(result).toEqual({
            tenantId: 'tenant-1',
            voucherType: VoucherType.CASH_PAYMENT,
            prefix: VOUCHER_NUMBER_PREFIXES[VoucherType.CASH_PAYMENT],
            nextSequenceNumber: 1,
            voucherNumber: 'CP-00001',
        });
    });

    it('generates the next voucher number inside a transaction', async () => {
        db.voucherSequence.upsert.mockResolvedValue({
            id: 'tenant-1:cash_payment',
            tenant_id: 'tenant-1',
            voucher_type: VoucherType.CASH_PAYMENT,
            prefix: 'CP',
            next_number: 1,
        });
        db.voucherSequence.update.mockResolvedValue({
            id: 'tenant-1:cash_payment',
            tenant_id: 'tenant-1',
            voucher_type: VoucherType.CASH_PAYMENT,
            prefix: 'CP',
            next_number: 2,
        });

        const result = await service.generateNextVoucherNumber('tenant-1', VoucherType.CASH_PAYMENT);

        expect(db.$transaction).toHaveBeenCalled();
        expect(db.voucherSequence.upsert).toHaveBeenCalledWith({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: 'tenant-1',
                    voucher_type: VoucherType.CASH_PAYMENT,
                },
            },
            update: {},
            create: {
                id: 'tenant-1:cash_payment',
                tenant_id: 'tenant-1',
                voucher_type: VoucherType.CASH_PAYMENT,
                prefix: 'CP',
                next_number: 1,
            },
        });
        expect(result.voucherNumber).toBe('CP-00001');
        expect(result.sequenceNumber).toBe(1);
    });

    it('creates balanced vouchers with nested details and a generated number', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', category: 'cash' },
            { id: 'account-expense', category: 'general' },
        ]);
        db.voucherSequence.upsert.mockResolvedValue({
            id: 'tenant-1:cash_payment',
            tenant_id: 'tenant-1',
            voucher_type: VoucherType.CASH_PAYMENT,
            prefix: 'CP',
            next_number: 1,
        });
        db.voucherSequence.update.mockResolvedValue({
            id: 'tenant-1:cash_payment',
            tenant_id: 'tenant-1',
            voucher_type: VoucherType.CASH_PAYMENT,
            prefix: 'CP',
            next_number: 2,
        });
        db.voucher.create.mockResolvedValue({
            id: 'voucher-1',
            voucher_number: 'CP-00001',
            details: [
                { account_id: 'account-cash', credit_amount: 50, debit_amount: 0 },
                { account_id: 'account-expense', debit_amount: 50, credit_amount: 0 },
            ],
        });

        const result = await service.createVoucher('tenant-1', {
            voucherType: VoucherType.CASH_PAYMENT,
            description: 'Office expense paid in cash',
            details: [
                { accountId: 'account-cash', debitAmount: 0, creditAmount: 50 },
                { accountId: 'account-expense', debitAmount: 50, creditAmount: 0 },
            ],
        });

        expect(result.voucher_number).toBe('CP-00001');
        expect(db.voucher.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                voucher_number: 'CP-00001',
                voucher_type: VoucherType.CASH_PAYMENT,
            }),
            include: expect.any(Object),
        });
    });

    it('lists vouchers with pagination metadata and computed totals', async () => {
        db.voucher.count.mockResolvedValue(2);
        db.voucher.findMany.mockResolvedValue([
            {
                id: 'voucher-1',
                voucher_number: 'CP-00001',
                voucher_type: VoucherType.CASH_PAYMENT,
                date: new Date('2026-03-21T00:00:00.000Z'),
                details: [
                    { debit_amount: 125, credit_amount: 0 },
                    { debit_amount: 0, credit_amount: 125 },
                ],
            },
        ]);

        const result = await service.findVouchers('tenant-1', {
            voucherType: VoucherType.CASH_PAYMENT,
            from: '2026-03-01',
            to: '2026-03-31',
            page: 2,
            limit: 10,
        });

        expect(db.voucher.count).toHaveBeenCalled();
        expect(db.voucher.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                voucher_type: VoucherType.CASH_PAYMENT,
            }),
            skip: 10,
            take: 10,
        }));
        expect(result.meta).toEqual({
            page: 2,
            limit: 10,
            total: 2,
            totalPages: 1,
        });
        expect(result.data[0].total_amount).toBe(125);
    });

    it('returns a single voucher with all detail rows', async () => {
        db.voucher.findFirst.mockResolvedValue({
            id: 'voucher-1',
            voucher_number: 'JV-00001',
            details: [
                { debit_amount: 50, credit_amount: 0, account: { name: 'Expense' } },
                { debit_amount: 0, credit_amount: 50, account: { name: 'Cash in Hand' } },
            ],
        });

        const result = await service.findVoucherById('tenant-1', 'voucher-1');

        expect(db.voucher.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                tenant_id: 'tenant-1',
                id: 'voucher-1',
            },
        }));
        expect(result.total_amount).toBe(50);
    });

    it('returns financial KPIs for a date range with positive cash movement', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', type: AccountType.ASSET, category: AccountCategory.CASH, name: 'Cash in Hand', code: '1010' },
            { id: 'account-bank', type: AccountType.ASSET, category: AccountCategory.BANK, name: 'Main Bank Account', code: '1020' },
            { id: 'account-revenue', type: AccountType.REVENUE, category: AccountCategory.GENERAL, name: 'Sales Revenue', code: '4010' },
            { id: 'account-expense', type: AccountType.EXPENSE, category: AccountCategory.GENERAL, name: 'General Operating Expense', code: '5010' },
        ]);
        db.voucherDetail.aggregate
            .mockResolvedValueOnce({ _sum: { debit_amount: 300, credit_amount: 125 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 300 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 125, credit_amount: 0 } });

        const result = await service.getFinancialKpis('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        expect(db.account.findMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
            },
            select: {
                id: true,
                type: true,
                category: true,
                name: true,
                code: true,
            },
        });
        expect(result).toEqual({
            filters: { from: '2026-03-01', to: '2026-03-31' },
            kpis: {
                cash_inflow: 300,
                cash_outflow: 125,
                net_cash_movement: 175,
                gross_revenue: 300,
                operating_expense: 125,
                accounts_receivable: null,
                accounts_payable: null,
                tax_liability: null,
            },
        });
    });

    it('returns a negative net cash movement when outflows exceed inflows', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', type: AccountType.ASSET, category: AccountCategory.CASH, name: 'Cash in Hand', code: '1010' },
            { id: 'account-revenue', type: AccountType.REVENUE, category: AccountCategory.GENERAL, name: 'Sales Revenue', code: '4010' },
            { id: 'account-expense', type: AccountType.EXPENSE, category: AccountCategory.GENERAL, name: 'General Operating Expense', code: '5010' },
        ]);
        db.voucherDetail.aggregate
            .mockResolvedValueOnce({ _sum: { debit_amount: 50, credit_amount: 140 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 50 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 140, credit_amount: 0 } });

        const result = await service.getFinancialKpis('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-31',
        });

        expect(result.kpis.net_cash_movement).toBe(-90);
        expect(result.kpis.gross_revenue).toBe(50);
        expect(result.kpis.operating_expense).toBe(140);
        expect(result.kpis.accounts_receivable).toBeNull();
        expect(result.kpis.accounts_payable).toBeNull();
        expect(result.kpis.tax_liability).toBeNull();
    });

    it('returns receivable, payable, and tax liability balances when matching accounts are configured', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', type: AccountType.ASSET, category: AccountCategory.CASH, name: 'Cash in Hand', code: '1010' },
            { id: 'account-revenue', type: AccountType.REVENUE, category: AccountCategory.GENERAL, name: 'Sales Revenue', code: '4010' },
            { id: 'account-expense', type: AccountType.EXPENSE, category: AccountCategory.GENERAL, name: 'General Operating Expense', code: '5010' },
            { id: 'account-ar', type: AccountType.ASSET, category: AccountCategory.GENERAL, name: 'Accounts Receivable', code: '1030' },
            { id: 'account-ap', type: AccountType.LIABILITY, category: AccountCategory.GENERAL, name: 'Purchase Payable', code: '2010' },
            { id: 'account-vat', type: AccountType.LIABILITY, category: AccountCategory.GENERAL, name: 'VAT Payable', code: '2020' },
        ]);
        db.voucherDetail.aggregate
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 0 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 90 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 35, credit_amount: 0 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 90, credit_amount: 0 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 20 } })
            .mockResolvedValueOnce({ _sum: { debit_amount: 0, credit_amount: 15 } });

        const result = await service.getFinancialKpis('tenant-1', {
            from: '2026-04-01',
            to: '2026-04-30',
        });

        expect(result.kpis.accounts_receivable).toBe(90);
        expect(result.kpis.accounts_payable).toBe(20);
        expect(result.kpis.tax_liability).toBe(15);
        expect(result.kpis.gross_revenue).toBe(90);
        expect(result.kpis.operating_expense).toBe(35);
    });

    it('returns negative receivable balances after over-settlement adjustments', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-ar', type: AccountType.ASSET, category: AccountCategory.GENERAL, name: 'Accounts Receivable', code: '1030' },
        ]);
        db.voucherDetail.aggregate.mockResolvedValueOnce({
            _sum: { debit_amount: 50, credit_amount: 80 },
        });

        const result = await service.getFinancialKpis('tenant-1', {
            from: '2026-04-01',
            to: '2026-04-30',
        });

        expect(result.kpis.accounts_receivable).toBe(-30);
        expect(result.kpis.accounts_payable).toBeNull();
        expect(result.kpis.tax_liability).toBeNull();
    });

    it('defaults KPI date filters to the current month when they are omitted', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-21T10:00:00.000Z'));
        db.account.findMany.mockResolvedValue([]);

        const result = await service.getFinancialKpis('tenant-1', {});

        expect(result.filters).toEqual({
            from: '2026-03-01',
            to: '2026-03-31',
        });

        jest.useRealTimers();
    });

    it('returns daily financial trend points and comparison totals for posted accounting movement', async () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', type: AccountType.ASSET, category: AccountCategory.CASH, name: 'Cash in Hand', code: '1010' },
            { id: 'account-revenue', type: AccountType.REVENUE, category: AccountCategory.GENERAL, name: 'Sales Revenue', code: '4010' },
            { id: 'account-expense', type: AccountType.EXPENSE, category: AccountCategory.GENERAL, name: 'General Operating Expense', code: '5010' },
        ]);
        db.voucherDetail.findMany.mockResolvedValue([
            {
                debit_amount: 0,
                credit_amount: 125,
                voucher: { date: new Date('2026-03-01T00:00:00.000Z') },
                account: { id: 'account-cash' },
            },
            {
                debit_amount: 125,
                credit_amount: 0,
                voucher: { date: new Date('2026-03-01T00:00:00.000Z') },
                account: { id: 'account-expense' },
            },
            {
                debit_amount: 300,
                credit_amount: 0,
                voucher: { date: new Date('2026-03-05T00:00:00.000Z') },
                account: { id: 'account-cash' },
            },
            {
                debit_amount: 0,
                credit_amount: 300,
                voucher: { date: new Date('2026-03-05T00:00:00.000Z') },
                account: { id: 'account-revenue' },
            },
        ]);

        const result = await service.getFinancialTrends('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-05',
        });

        expect(result.filters).toEqual({ from: '2026-03-01', to: '2026-03-05' });
        expect(result.granularity).toBe('day');
        expect(result.has_activity).toBe(true);
        expect(result.points).toEqual([
            {
                date: '2026-03-01',
                cash_inflow: 0,
                cash_outflow: 125,
                net_cash_movement: -125,
                gross_revenue: 0,
                operating_expense: 125,
                net_profit: -125,
            },
            {
                date: '2026-03-02',
                cash_inflow: 0,
                cash_outflow: 0,
                net_cash_movement: 0,
                gross_revenue: 0,
                operating_expense: 0,
                net_profit: 0,
            },
            {
                date: '2026-03-03',
                cash_inflow: 0,
                cash_outflow: 0,
                net_cash_movement: 0,
                gross_revenue: 0,
                operating_expense: 0,
                net_profit: 0,
            },
            {
                date: '2026-03-04',
                cash_inflow: 0,
                cash_outflow: 0,
                net_cash_movement: 0,
                gross_revenue: 0,
                operating_expense: 0,
                net_profit: 0,
            },
            {
                date: '2026-03-05',
                cash_inflow: 300,
                cash_outflow: 0,
                net_cash_movement: 300,
                gross_revenue: 300,
                operating_expense: 0,
                net_profit: 300,
            },
        ]);
        expect(result.comparison).toEqual({
            net_profit: 175,
            gross_margin: null,
            gross_margin_status: 'unavailable',
            gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
        });
    });

    it('returns zeroed financial trends and an unavailable gross margin when there is no accounting activity', async () => {
        db.account.findMany.mockResolvedValue([]);

        const result = await service.getFinancialTrends('tenant-1', {
            from: '2026-03-01',
            to: '2026-03-03',
        });

        expect(result.has_activity).toBe(false);
        expect(result.points).toHaveLength(3);
        expect(result.points.every((point) => point.net_profit === 0 && point.net_cash_movement === 0)).toBe(true);
        expect(result.comparison.gross_margin_status).toBe('unavailable');
    });

    it('rejects invalid KPI date ranges', async () => {
        await expect(
            service.getFinancialKpis('tenant-1', {
                from: '2026-03-31',
                to: '2026-03-01',
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('returns a debit-normal ledger with opening balance and running totals', async () => {
        db.account.findFirst.mockResolvedValue({
            id: 'account-cash',
            name: 'Cash in Hand',
            type: AccountType.ASSET,
            category: AccountCategory.CASH,
            code: '1010',
            group: { id: 'group-1', name: 'Current Assets' },
            subgroup: { id: 'subgroup-1', name: 'Cash and Bank' },
        });
        db.voucherDetail.aggregate.mockResolvedValue({
            _sum: {
                debit_amount: 0,
                credit_amount: 125,
            },
        });
        db.voucherDetail.findMany.mockResolvedValue([
            {
                id: 'detail-1',
                voucher_id: 'voucher-2',
                debit_amount: 300,
                credit_amount: 0,
                comment: 'Customer receipt',
                created_at: new Date('2026-03-05T09:00:00.000Z'),
                voucher: {
                    id: 'voucher-2',
                    voucher_number: 'CR-00001',
                    voucher_type: VoucherType.CASH_RECEIVE,
                    description: 'Customer collection',
                    reference_number: 'RCPT-1',
                    date: new Date('2026-03-05T00:00:00.000Z'),
                },
            },
        ]);

        const result = await service.findLedger('tenant-1', 'account-cash', {
            from: '2026-03-05',
            to: '2026-03-31',
        });

        expect(db.voucherDetail.aggregate).toHaveBeenCalledWith({
            where: {
                account_id: 'account-cash',
                voucher: {
                    tenant_id: 'tenant-1',
                    date: { lt: new Date('2026-03-05T00:00:00.000Z') },
                },
            },
            _sum: {
                debit_amount: true,
                credit_amount: true,
            },
        });
        expect(result.normal_balance_side).toBe('debit');
        expect(result.opening_balance).toBe(125);
        expect(result.opening_balance_side).toBe('credit');
        expect(result.closing_balance).toBe(175);
        expect(result.closing_balance_side).toBe('debit');
        expect(result.data[0]).toMatchObject({
            voucher_number: 'CR-00001',
            debit_amount: 300,
            credit_amount: 0,
            running_balance: 175,
            running_balance_side: 'debit',
        });
    });

    it('normalizes credit-normal ledgers and flips balance side when debits exceed credits', async () => {
        db.account.findFirst.mockResolvedValue({
            id: 'account-revenue',
            name: 'Sales Revenue',
            type: AccountType.REVENUE,
            category: AccountCategory.GENERAL,
            code: '4010',
            group: { id: 'group-4', name: 'Operating Revenue' },
            subgroup: { id: 'subgroup-4', name: 'Sales' },
        });
        db.voucherDetail.aggregate.mockResolvedValue({
            _sum: {
                debit_amount: 0,
                credit_amount: 100,
            },
        });
        db.voucherDetail.findMany.mockResolvedValue([
            {
                id: 'detail-2',
                voucher_id: 'voucher-3',
                debit_amount: 140,
                credit_amount: 0,
                comment: 'Revenue reversal',
                created_at: new Date('2026-03-06T09:00:00.000Z'),
                voucher: {
                    id: 'voucher-3',
                    voucher_number: 'JV-00001',
                    voucher_type: VoucherType.JOURNAL,
                    description: 'Revenue adjustment',
                    reference_number: 'JV-1',
                    date: new Date('2026-03-06T00:00:00.000Z'),
                },
            },
        ]);

        const result = await service.findLedger('tenant-1', 'account-revenue', {
            from: '2026-03-06',
        });

        expect(result.normal_balance_side).toBe('credit');
        expect(result.opening_balance).toBe(100);
        expect(result.opening_balance_side).toBe('credit');
        expect(result.closing_balance).toBe(40);
        expect(result.closing_balance_side).toBe('debit');
        expect(result.data[0].running_balance_side).toBe('debit');
    });

    it('rejects invalid ledger date ranges', async () => {
        await expect(
            service.findLedger('tenant-1', 'account-cash', {
                from: '2026-03-31',
                to: '2026-03-01',
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects unbalanced vouchers before any write occurs', async () => {
        await expect(
            service.createVoucher('tenant-1', {
                voucherType: VoucherType.JOURNAL,
                details: [
                    { accountId: 'account-a', debitAmount: 60, creditAmount: 0 },
                    { accountId: 'account-b', debitAmount: 0, creditAmount: 50 },
                ],
            }),
        ).rejects.toThrow(BadRequestException);

        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects mixed tenant account usage during voucher creation', async () => {
        db.account.findMany.mockResolvedValue([{ id: 'account-cash', category: 'cash' }]);

        await expect(
            service.createVoucher('tenant-1', {
                voucherType: VoucherType.CASH_PAYMENT,
                details: [
                    { accountId: 'account-cash', debitAmount: 0, creditAmount: 50 },
                    { accountId: 'account-expense', debitAmount: 50, creditAmount: 0 },
                ],
            }),
        ).rejects.toThrow(BadRequestException);
    });
});