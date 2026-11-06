jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MushakBooksPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({
    api: {
        getMushakSalesBook: jest.fn(),
        getMushakLargeSupplyStatement: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/mushak',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
}));

// A wide screen, so the chips sit in the toolbar and every column is drawn.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const ISSUER = {
    name: 'Rahim Traders',
    bin: '000123456-0101',
    tin: null,
    address: 'Mirpur, Dhaka',
    economicActivity: null,
    officerName: 'Rahim',
    officerDesignation: 'Owner',
    readiness: { ready: true, missing: [] },
};

const row = (saleId: string, invoiceNumber: string, buyer: string, totalValue: number, vatAmount: number) => ({
    saleId,
    date: '2026-11-02',
    invoiceNumber,
    buyer: { name: buyer, bin: '000999888-0101', nid: null, address: 'Gulshan' },
    branch: null,
    description: 'Rice 50kg',
    quantity: 2,
    totalValue,
    sdAmount: 0,
    vatAmount,
    inclusiveTotal: totalValue + vatAmount,
});

const BOOK = {
    form: '6.2',
    issuer: ISSUER,
    period: { from: '2026-11-01', to: '2026-11-30', timezone: 'Asia/Dhaka' },
    rows: [row('s1', 'INV-001', 'Karim Store', 10000, 1500), row('s2', 'INV-002', 'Salma Mart', 4000, 600)],
    totals: { invoices: 2, totalValue: 14000, sdAmount: 0, vatAmount: 2100, inclusiveTotal: 16100 },
    estimated: false,
};

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

function stat(label: string): string {
    const strip = screen.getByRole('region', { name: 'VAT book summary' });
    return within(strip).getByText(label).nextElementSibling?.textContent ?? '';
}

/** The on-screen list's rows — the first body; the printed form's comes after. */
const tableBody = () => screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TBODY')!;
const loaded = () => waitFor(() => expect(tableBody()).toHaveTextContent('Karim Store'));

describe('MushakBooksPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api.getMushakSalesBook.mockResolvedValue(BOOK);
        api.getMushakLargeSupplyStatement.mockResolvedValue({ ...BOOK, form: '6.10', threshold: 200000 });
    });

    it('loads the sales book for the tax period under way, for the branch', async () => {
        render(<MushakBooksPage />);

        await waitFor(() => expect(api.getMushakSalesBook).toHaveBeenCalledWith(
            expect.objectContaining({ storeId: 'store-1', taxableOnly: false, from: expect.stringMatching(/-01$/) }),
        ));
        await loaded();
    });

    it('totals the book in the strip', async () => {
        render(<MushakBooksPage />);
        await loaded();

        expect(stat('Invoices')).toBe('2');
        expect(stat('Value excl. tax')).toContain('14,000');
        expect(stat('VAT')).toContain('2,100');
        expect(stat('Total incl. tax')).toContain('16,100');
    });

    it('searches the book, and the strip follows', async () => {
        render(<MushakBooksPage />);
        await loaded();

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'INV-002' } });

        await waitFor(() => expect(tableBody()).not.toHaveTextContent('Karim Store'));
        expect(stat('Invoices')).toBe('1');
        expect(stat('VAT')).toContain('600');
    });

    it('asks for taxable supplies only from the toolbar', async () => {
        render(<MushakBooksPage />);
        await loaded();

        fireEvent.click(screen.getByRole('button', { name: 'Taxable supplies only' }));

        await waitFor(() => expect(api.getMushakSalesBook).toHaveBeenLastCalledWith(
            expect.objectContaining({ taxableOnly: true }),
        ));
    });

    it('takes its tax period from the toolbar chip', async () => {
        render(<MushakBooksPage />);
        await loaded();

        fireEvent.click(chip(/^Tax period/));
        fireEvent.click(screen.getByRole('button', { name: 'This year' }));

        await waitFor(() => expect(api.getMushakSalesBook).toHaveBeenLastCalledWith(
            expect.objectContaining({ from: expect.stringMatching(/-01-01$/) }),
        ));
    });

    it('switches to the 6.10 statement from the Form chip', async () => {
        render(<MushakBooksPage />);
        await loaded();

        fireEvent.change(screen.getByRole('combobox', { name: 'Form' }), { target: { value: '6.10' } });

        await waitFor(() => expect(api.getMushakLargeSupplyStatement).toHaveBeenCalled());
        expect(screen.getByRole('heading', { name: 'Large Supplies (Mushak 6.10)' })).toBeInTheDocument();
        expect(stat('Threshold')).toContain('2,00,000');
        // No taxable-only switch on a statement of untaxed buyers.
        expect(screen.queryByRole('button', { name: 'Taxable supplies only' })).not.toBeInTheDocument();
    });

    it('keeps the gazetted form, with its Bangla headings and the whole book, for the printer', async () => {
        const { container } = render(<MushakBooksPage />);
        await loaded();
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'INV-002' } });

        const printed = container.querySelector('#mushak-printable') as HTMLElement;
        expect(printed).not.toBeNull();
        expect(printed.closest('.print\\:block')).toHaveClass('hidden');
        expect(within(printed).getByText('ক্রেতার নাম')).toBeInTheDocument();
        // Search narrows the screen list only: the printed book is always whole.
        await waitFor(() => expect(tableBody()).not.toHaveTextContent('Karim Store'));
        expect(within(printed).getByText('Karim Store')).toBeInTheDocument();
    });

    it('warns when the issuer block is incomplete', async () => {
        api.getMushakSalesBook.mockResolvedValue({
            ...BOOK,
            issuer: { ...ISSUER, readiness: { ready: false, missing: ['bin'] } },
        });
        render(<MushakBooksPage />);

        expect(await screen.findByText('This is not yet a valid tax invoice')).toBeInTheDocument();
    });
});
