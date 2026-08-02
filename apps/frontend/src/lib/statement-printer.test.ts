import {
    printStatementReport,
    printTrialBalanceReport,
    reportContextLines,
    type StatementPrintMeta,
} from './statement-printer';

function capturePrintedHtml(run: () => void): string {
    const write = jest.fn();
    const mockWindow = {
        document: { write, close: jest.fn(), images: [] },
        print: jest.fn(),
    };
    const open = jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    run();

    expect(open).toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    open.mockRestore();
    return write.mock.calls[0][0] as string;
}

const META: StatementPrintMeta = {
    businessName: 'Northwind Traders',
    title: 'Profit & Loss Account',
    periodLabel: 'Period',
    periodValue: '2026-03-01 — 2026-03-31',
    contextLines: ['Branch: Dhaka', 'Level: Account'],
    locale: 'en',
    generatedLabel: 'Generated',
    generatedAt: '3 Aug 2026, 10:00',
};

const LABELS = { account: 'Account', amount: 'Amount', noRows: 'Nothing to show' };

const group = (name: string, code: string, rows: Array<[string, string, number]>, total: number) => ({
    group: { id: code, name, code },
    rows: rows.map(([id, rowName, balance]) => ({ id, name: rowName, code: id, balance })),
    total,
});

describe('printStatementReport', () => {
    it('prints the business name, period and the toolbar context it was run with', () => {
        const html = capturePrintedHtml(() => printStatementReport(
            META,
            [{
                label: 'Revenue',
                groups: [group('Sales', '4100', [['4101', 'Product Sales', 600_000]], 600_000)],
                totalLabel: 'Total Revenue',
                total: 600_000,
            }],
            [{ label: 'Net Profit', amount: 358_000, strong: true }],
            LABELS,
        ));

        expect(html).toContain('Northwind Traders');
        expect(html).toContain('2026-03-01 — 2026-03-31');
        expect(html).toContain('Branch: Dhaka');
        expect(html).toContain('Level: Account');
        expect(html).toContain('Generated');
        expect(html).toContain('Product Sales');
        expect(html).toContain('Net Profit');
    });

    it('renders money through formatBDT, never a bare number or a dollar sign', () => {
        const html = capturePrintedHtml(() => printStatementReport(
            META,
            [{
                label: 'Revenue',
                groups: [group('Sales', '4100', [['4101', 'Product Sales', 600_000]], 600_000)],
                totalLabel: 'Total Revenue',
                total: 600_000,
            }],
            [],
            LABELS,
        ));

        expect(html).toContain('৳');
        expect(html).not.toContain('$');
        // The raw figure must not leak through unformatted.
        expect(html).not.toContain('>600000<');
    });

    it('escapes account names so a stray angle bracket cannot inject markup', () => {
        const html = capturePrintedHtml(() => printStatementReport(
            META,
            [{
                label: 'Revenue',
                groups: [group('Sales', '4100', [['4101', '<script>alert(1)</script>', 10]], 10)],
                totalLabel: 'Total',
                total: 10,
            }],
            [],
            LABELS,
        ));

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('says so rather than printing an empty section when a statement has no groups', () => {
        const html = capturePrintedHtml(() => printStatementReport(
            META,
            [{ label: 'Revenue', groups: [], totalLabel: 'Total Revenue', total: 0 }],
            [],
            LABELS,
        ));

        expect(html).toContain('Nothing to show');
    });

    it('prints a group-level statement without rows using the group total', () => {
        // At level=group the server sends groups with no rows; the total is then
        // the only figure there is, and it has to survive to the page.
        const html = capturePrintedHtml(() => printStatementReport(
            META,
            [{
                label: 'Revenue',
                groups: [group('Sales', '4100', [], 600_000)],
                totalLabel: 'Total Revenue',
                total: 600_000,
            }],
            [],
            LABELS,
        ));

        expect(html).toContain('Sales');
        expect((html.match(/৳/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('printTrialBalanceReport', () => {
    const TB_LABELS = {
        code: 'Code',
        account: 'Account',
        type: 'Type',
        grossDebit: 'Gross Debit',
        grossCredit: 'Gross Credit',
        debitBalance: 'Debit Balance',
        creditBalance: 'Credit Balance',
        totals: 'Totals',
        noRows: 'Nothing to show',
    };

    it('prints every column plus the server totals', () => {
        const html = capturePrintedHtml(() => printTrialBalanceReport(
            { ...META, title: 'Trial Balance', periodLabel: 'As of', periodValue: '2026-03-31', statusNote: 'Balanced' },
            [{
                code: '1101',
                name: 'Cash in Hand',
                group: 'Current Assets',
                type: 'asset',
                debitTotal: 50_000,
                creditTotal: 12_000,
                debitBalance: 38_000,
                creditBalance: 0,
            }],
            { debit: 38_000, credit: 38_000 },
            TB_LABELS,
        ));

        expect(html).toContain('Balanced');
        expect(html).toContain('Cash in Hand');
        expect(html).toContain('Current Assets');
        expect(html).toContain('Gross Debit');
        expect(html).toContain('Totals');
    });

    it('dashes an empty balance column instead of printing a zero', () => {
        const html = capturePrintedHtml(() => printTrialBalanceReport(
            { ...META, title: 'Trial Balance', periodLabel: 'As of', periodValue: '2026-03-31' },
            [{
                code: '1101',
                name: 'Cash in Hand',
                type: 'asset',
                debitTotal: 50_000,
                creditTotal: 12_000,
                debitBalance: 38_000,
                creditBalance: 0,
            }],
            { debit: 38_000, credit: 38_000 },
            TB_LABELS,
        ));

        // A zero credit balance reads as a real balance of nil; the table shows —.
        expect(html).toContain('—');
    });

    it('says so when every row was filtered out', () => {
        const html = capturePrintedHtml(() => printTrialBalanceReport(
            { ...META, title: 'Trial Balance', periodLabel: 'As of', periodValue: '2026-03-31' },
            [],
            { debit: 0, credit: 0 },
            TB_LABELS,
        ));

        expect(html).toContain('Nothing to show');
    });
});

describe('reportContextLines', () => {
    const LINE_LABELS = {
        scopeBranch: 'Branch',
        scopeCompany: 'Company',
        levelLabel: 'Level',
        approvedOnly: 'Approved vouchers only',
        allVouchers: 'All vouchers',
    };

    it('names the branch for a branch-scoped report', () => {
        expect(reportContextLines(
            { scope: 'branch', storeName: 'Dhaka', level: 'account', levelLabel: 'Account', approvedOnly: false, approvalEnabled: false },
            LINE_LABELS,
        )).toEqual(['Branch: Dhaka', 'Level: Account']);
    });

    it('omits the approval line for tenants that do not run voucher approval', () => {
        const lines = reportContextLines(
            { scope: 'company', level: 'group', levelLabel: 'Group', approvedOnly: true, approvalEnabled: false },
            LINE_LABELS,
        );
        expect(lines).toEqual(['Company', 'Level: Group']);
    });

    it('states which voucher set the figures came from when approval is on', () => {
        expect(reportContextLines(
            { scope: 'company', level: 'account', levelLabel: 'Account', approvedOnly: true, approvalEnabled: true },
            LINE_LABELS,
        )).toContain('Approved vouchers only');

        expect(reportContextLines(
            { scope: 'company', level: 'account', levelLabel: 'Account', approvedOnly: false, approvalEnabled: true },
            LINE_LABELS,
        )).toContain('All vouchers');
    });
});
