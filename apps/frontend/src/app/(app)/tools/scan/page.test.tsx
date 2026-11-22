import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillScanPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('@/lib/api', () => ({
    api: { getAiUsage: jest.fn(), scanBill: jest.fn(), getExpenseHeads: jest.fn(), createExpenseEntry: jest.fn() },
}));

// jsdom cannot decode images; the shrink is tested on its own.
jest.mock('@/components/tools/files', () => ({
    shrinkImage: jest.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1200, height: 1600, mimeType: 'image/jpeg' }),
    fileToDataUrl: jest.fn(),
}));

const SCAN = {
    target: 'purchase',
    vendorName: 'Rahim Traders',
    vendorPhone: null,
    vendorAddress: null,
    billNumber: 'M-55',
    billDate: '2026-11-20',
    lines: [{ description: 'Teer Oil', quantity: 2, unitPrice: 900, lineTotal: 1800, product: { id: 'p1', name: 'Teer Oil 5L' } }],
    subtotal: 1800,
    discount: null,
    tax: null,
    freight: null,
    total: 1800,
    summary: null,
    supplier: null,
    credits_used: 3.12,
    credits_estimate: { expected: 3.8, max: 5.1 },
};

async function pickPhoto() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'bill.jpg', { type: 'image/jpeg' })] } });
    });
}

describe('BillScanPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAiUsage as jest.Mock).mockResolvedValue({ credits_limit: 500, credits_remaining: 120 });
        (api.scanBill as jest.Mock).mockResolvedValue(SCAN);
    });

    it('shows the estimated credits and asks before spending them', async () => {
        render(<BillScanPage />);
        await pickPhoto();

        expect(await screen.findByText(/This scan will use about/)).toBeInTheDocument();
        expect(screen.getByText(/You have 120 of 500 credits left/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Scan for about/ }));
        // Nothing is sent until the confirmation is accepted.
        expect(api.scanBill).not.toHaveBeenCalled();
        expect(await screen.findByText('Use AI credits?')).toBeInTheDocument();
        expect(screen.getByText(/You have 120 left this month/)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Scan now' }));
        });
        await waitFor(() => expect(api.scanBill).toHaveBeenCalledWith(expect.objectContaining({ target: 'purchase', width: 1200, height: 1600 })));
        expect(await screen.findByText(/Used 3.1 credits/)).toBeInTheDocument();
    });

    it('does not scan when the credits left cannot cover it', async () => {
        (api.getAiUsage as jest.Mock).mockResolvedValue({ credits_limit: 100, credits_remaining: 1 });
        render(<BillScanPage />);
        await pickPhoto();

        expect(await screen.findByText(/do not have enough AI credits/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Scan for about/ })).toBeDisabled();
    });

    it('hands a reviewed purchase to the purchase form', async () => {
        render(<BillScanPage />);
        await pickPhoto();
        fireEvent.click(await screen.findByRole('button', { name: /Scan for about/ }));
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: 'Scan now' }));
        });

        fireEvent.click(await screen.findByRole('button', { name: /Open in purchase form/ }));
        expect(push).toHaveBeenCalledWith('/purchases/new?from=scan');
        expect(JSON.parse(window.sessionStorage.getItem('erp71.billScan.purchaseDraft')!).newSupplier.name).toBe('Rahim Traders');
    });
});
