import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentNumberingPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getDocumentNumbering: jest.fn(),
        updateDocumentNumbering: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages }) };
});

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/settings/document-numbering',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const loaded = {
    docType: 'SALE',
    config: { template: 'INV-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
    isDefault: true,
    today: { year: 2026, month: 10 },
    stores: [
        { id: 'dhk', name: 'Dhaka', code: 'S1' },
        { id: 'ctg', name: 'Chattogram', code: 'S2' },
    ],
    counters: [],
    sequences: [{ periodKey: '2627', scopeKey: '', nextNumber: 43 }],
};

describe('DocumentNumberingPage', () => {
    const { api } = require('@/lib/api');
    const { toast } = require('@/lib/toast');

    beforeEach(() => {
        jest.clearAllMocks();
        api.getDocumentNumbering.mockResolvedValue(loaded);
        api.updateDocumentNumbering.mockImplementation(async (_type: string, body: any) => ({ ...loaded, config: {
            template: body.template, resetPolicy: body.resetPolicy, scope: body.scope, seqWidth: body.seqWidth,
        } }));
    });

    it('previews the next invoice from where the counter stands', async () => {
        render(<DocumentNumberingPage />);

        expect(await screen.findByText('INV-2627-00043', { selector: '.font-semibold' })).toBeInTheDocument();
        expect(screen.getByText(/Fiscal year 2026–27/)).toBeInTheDocument();
        expect(api.getDocumentNumbering).toHaveBeenCalledWith('SALE');
    });

    it('explains inline why a format would repeat numbers, and does not save it', async () => {
        render(<DocumentNumberingPage />);
        const format = await screen.findByLabelText(/Format/);

        fireEvent.change(format, { target: { value: 'INV-{SEQ}' } });

        expect(screen.getByRole('alert')).toHaveTextContent(/fiscal-year reset needs \{FY\}/);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(api.updateDocumentNumbering).not.toHaveBeenCalled();
    });

    it('asks for branch codes when the format prints one, and saves only what changed', async () => {
        render(<DocumentNumberingPage />);
        fireEvent.change(await screen.findByLabelText('Start from'), { target: { value: 'per-branch' } });

        const dhaka = screen.getByLabelText('Dhaka', { selector: '#sale-code-dhk' });
        fireEvent.change(dhaka, { target: { value: 'dhk' } });
        // The preview follows the code as it is typed.
        expect(screen.getAllByText('DHK-2627-00001').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateDocumentNumbering).toHaveBeenCalledWith('SALE', {
            template: '{STORE}-{FY}-{SEQ}',
            resetPolicy: 'FISCAL_YEAR',
            scope: 'STORE',
            seqWidth: 5,
            storeCodes: [{ storeId: 'dhk', code: 'DHK' }],
        }));
        expect(toast.success).toHaveBeenCalled();
    });

    it('refuses a next number below where the counter stands', async () => {
        render(<DocumentNumberingPage />);
        const next = await screen.findByLabelText('Whole business');

        fireEvent.change(next, { target: { value: '10' } });

        expect(screen.getByText(/Cannot go below 43/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(api.updateDocumentNumbering).not.toHaveBeenCalled();
    });

    it('sends a raised next number', async () => {
        render(<DocumentNumberingPage />);
        fireEvent.change(await screen.findByLabelText('Whole business'), { target: { value: '1848' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateDocumentNumbering).toHaveBeenCalledWith('SALE', expect.objectContaining({
            nextNumbers: [{ scopeKey: '', nextNumber: 1848 }],
        })));
    });

    it('edits each document type on its own tab, saving only that type', async () => {
        api.getDocumentNumbering.mockImplementation(async (docType: string) => (docType === 'PURCHASE'
            ? {
                ...loaded,
                docType: 'PURCHASE',
                config: { template: 'PUR-{SEQ}', resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 5 },
                // Continuing after the purchases numbered before there was a counter.
                sequences: [{ periodKey: '', scopeKey: '', nextNumber: 1849 }],
            }
            : loaded));
        render(<DocumentNumberingPage />);
        const salesFormat = await screen.findByLabelText(/Format/);
        fireEvent.change(salesFormat, { target: { value: 'BILL-{FY}-{SEQ}' } });

        fireEvent.click(screen.getByRole('tab', { name: 'Purchases' }));

        expect(await screen.findByText('PUR-01849', { selector: '.font-semibold' })).toBeInTheDocument();
        expect(screen.getByText('Next purchase:', { exact: false })).toBeInTheDocument();
        // A supplier bill has no till: no per-counter series, no {COUNTER} button.
        const series = screen.getByLabelText('Series', { selector: '#purchase-scope' }) as HTMLSelectElement;
        expect([...series.options].map((o) => o.value)).toEqual(['TENANT', 'STORE']);
        expect(screen.queryByRole('button', { name: /\{COUNTER\}/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateDocumentNumbering).toHaveBeenCalledWith('PURCHASE', {
            template: 'PUR-{SEQ}', resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 5,
        }));

        // The sales edit is still there when its tab comes back.
        fireEvent.click(screen.getByRole('tab', { name: 'Sales invoices' }));
        expect((screen.getByLabelText(/Format/, { selector: '#sale-template' }) as HTMLInputElement).value).toBe('BILL-{FY}-{SEQ}');
        expect(screen.getByLabelText(/Format/, { selector: '#purchase-template' })).not.toBeVisible();
        expect(api.getDocumentNumbering).toHaveBeenCalledTimes(2);
    });

    it('says so when the page cannot load', async () => {
        api.getDocumentNumbering.mockRejectedValue(new Error('Forbidden'));

        render(<DocumentNumberingPage />);

        expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    });
});
