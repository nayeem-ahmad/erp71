import { createColumnHelper, getCoreRowModel, getFilteredRowModel, createTable } from '@tanstack/react-table';
import { openPrintWindow } from '@/lib/print';
import { printTable } from './export-utils';

jest.mock('@/lib/print', () => ({
    ...jest.requireActual('@/lib/print'),
    openPrintWindow: jest.fn(),
}));

interface Line {
    account: string;
    debit: number;
}

function table() {
    const helper = createColumnHelper<Line>();
    const columns = [
        helper.accessor('account', { id: 'account', header: 'Account' }),
        helper.accessor('debit', { id: 'debit', header: 'Debit', meta: { align: 'end' } }),
    ];
    const data: Line[] = [{ account: 'Cash', debit: 300 }];
    return createTable({
        data,
        columns,
        state: { columnVisibility: {}, columnOrder: [] },
        onStateChange: () => {},
        renderFallbackValue: null,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });
}

const bodyHtml = () => (openPrintWindow as jest.Mock).mock.calls.at(-1)[0].bodyHtml as string;

describe('printTable — totals row', () => {
    beforeEach(() => (openPrintWindow as jest.Mock).mockClear());

    it('adds the totals as the last body row, label first and figures aligned', () => {
        printTable(table(), 'Ledger', undefined, 'A4', { label: 'Totals', cells: { debit: '৳300 & <b>' } });
        const html = bodyHtml();
        expect(html).toContain('<tr class="totals"><td><strong>Totals</strong></td><td style="text-align:end"><strong>৳300 &amp; &lt;b&gt;</strong></td></tr></tbody>');
        // A <tfoot> would repeat on every printed page.
        expect(html).not.toContain('<tfoot>');
    });

    it('prints no totals row without one', () => {
        printTable(table(), 'Ledger');
        expect(bodyHtml()).not.toContain('class="totals"');
    });
});
