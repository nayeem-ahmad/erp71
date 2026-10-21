jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });

const { enMessages } = require('@/lib/localization/messages/en');

import React from 'react';
jest.mock('@/lib/hooks/useSalePrintPrefs', () => require('@/test-utils/print-paper').salePrintPrefsModuleMock());
jest.mock('@/lib/print', () => require('@/test-utils/print-paper').printModuleSpy());
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { mockBrowserPaper, printedPaper } from '@/test-utils/print-paper';
import ReturnDetailPage from './page';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: jest.fn(() => ({ id: 'ret-1' })),
    useRouter: jest.fn(() => ({ push: pushMock })),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getReturn: jest.fn(),
        updateReturn: jest.fn(),
        getPaymentLayout: jest.fn(),
        getPaymentMethods: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: number) => `BDT ${v}`,
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
}));

const BKASH = {
    id: 'pm-bkash',
    name: 'bKash',
    type: 'Mobile Wallet',
    account_id: null,
    is_active: true,
    sort_order: 1,
    show_on_entry: true,
    all_branches: true,
    store_ids: [],
};

const mockReturn = {
    id: 'ret-1',
    store_id: 'store-1',
    // Saved with its refund tenders: ৳750, all of it on bKash.
    tenders_recorded: true,
    payments: [
        {
            id: 'rp-1',
            payment_method: 'Mobile Wallet',
            payment_method_name: 'bKash',
            payment_method_id: 'pm-bkash',
            account_id: 'acc-bkash',
            amount: '750.00',
            reference_no: 'TX-77',
        },
    ],
    return_number: 'RET-00001',
    created_at: '2026-03-20T12:00:00.000Z',
    total_refund: '750',
    status: 'COMPLETED',
    reason: 'Defective product',
    sale: {
        serial_number: 'SALE-001',
        customer_id: 'cust-1',
        items: [
            {
                id: 'sale-item-1',
                quantity: 5,
                price_at_sale: '250',
                returns: [
                    { return_id: 'ret-1', quantity: 3 },
                ],
            },
        ],
    },
    items: [
        {
            id: 'ret-item-1',
            sale_item_id: 'sale-item-1',
            product_id: 'prod-1',
            quantity: 3,
            refund_amount: '750',
            product: { name: 'Coffee Beans' },
        },
    ],
};

function getApi() {
    return require('@/lib/api').api;
}

function setEditMode(enabled: boolean) {
    const nav = require('next/navigation');
    nav.useSearchParams.mockReturnValue({
        get: (k: string) => (k === 'edit' && enabled ? 'true' : null),
    });
}

describe('ReturnDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pushMock.mockReset();
        window.alert = jest.fn();
        window.confirm = jest.fn(() => true);
        window.open = jest.fn(() => ({
            document: { write: jest.fn(), close: jest.fn() },
            print: jest.fn(),
        })) as any;
        setEditMode(false);

        const nav = require('next/navigation');
        nav.useRouter.mockReturnValue({ push: pushMock });
        nav.useParams.mockReturnValue({ id: 'ret-1' });

        const api = getApi();
        api.getReturn.mockResolvedValue(mockReturn);
        api.updateReturn.mockResolvedValue({ ...mockReturn });
        api.getPaymentLayout.mockResolvedValue({ customised: false, visible: [BKASH], available: [BKASH] });
        api.getPaymentMethods.mockResolvedValue([BKASH]);
    });

    it('shows loading state initially', () => {
        const api = getApi();
        api.getReturn.mockReturnValue(new Promise(() => {}));
        render(<ReturnDetailPage />);
        expect(screen.getByText(/loading return/i)).toBeInTheDocument();
    });

    it('renders return details after loading', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('RET-00001').length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText('SALE-001').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Coffee Beans').length).toBeGreaterThan(0);
    });

    it('shows "Return not found" when API returns null', async () => {
        const api = getApi();
        api.getReturn.mockResolvedValue(null);
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(/return not found/i)).toBeInTheDocument();
        });
    });

    it('shows return reason in view mode', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('Defective product').length).toBeGreaterThan(0);
        });
    });

    it('shows COMPLETED status badge', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(enMessages.shared.statuses.return.COMPLETED)).toBeInTheDocument();
        });
    });

    it('shows total refund amount', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('BDT 750').length).toBeGreaterThan(0);
        });
    });

    it('shows quantity returned', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('3').length).toBeGreaterThan(0);
        });
    });

    it('shows original sale receipt number', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getAllByText('SALE-001').length).toBeGreaterThan(0);
        });
    });

    it('shows Edit and Print buttons in view mode', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /print preview/i })).toBeInTheDocument();
        });
    });

    it('navigates to edit mode when Edit is clicked', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /^edit$/i }));
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        expect(pushMock).toHaveBeenCalledWith('/sales/returns/ret-1?edit=true');
    });

    it('opens print window when Print Preview is clicked', async () => {
        render(<ReturnDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /print preview/i }));
        fireEvent.click(screen.getByRole('button', { name: /print preview/i }));
        // Printing first resolves the return's own branch letterhead.
        await waitFor(() => expect(window.open).toHaveBeenCalled());
    });

    it('return detail lists recorded payments; edit sends payments', async () => {
        // View mode: the refund as it was recorded, read-only.
        const { unmount } = render(<ReturnDetailPage />);
        expect(await screen.findByText('bKash')).toBeInTheDocument();
        expect(screen.getAllByText('BDT 750').length).toBeGreaterThan(1);
        expect(screen.getByText('TX-77')).toBeInTheDocument();
        expect(screen.queryByLabelText('bKash amount')).not.toBeInTheDocument();
        expect(getApi().getPaymentLayout).not.toHaveBeenCalled();
        unmount();

        // Edit mode: the same refund, editable, and sent back on save.
        setEditMode(true);
        render(<ReturnDetailPage />);
        const amount = (await screen.findByLabelText('bKash amount')) as HTMLInputElement;
        await waitFor(() => expect(amount.value).toBe('750'));
        fireEvent.change(screen.getByDisplayValue('Defective product'), { target: { value: 'Changed reason' } });
        fireEvent.click(screen.getAllByRole('button', { name: /save changes/i })[0]);

        await waitFor(() => expect(getApi().updateReturn).toHaveBeenCalledTimes(1));
        const [, body] = getApi().updateReturn.mock.calls[0];
        // Exactly the DTO's fields — and the cheque details come back with it.
        expect(body.payments).toEqual([
            { paymentMethod: 'Mobile Wallet', paymentMethodId: 'pm-bkash', amount: 750, referenceNo: 'TX-77' },
        ]);
    });

    it('leaves the refund of a return saved before tenders alone unless the user sets one', async () => {
        setEditMode(true);
        getApi().getReturn.mockResolvedValue({ ...mockReturn, tenders_recorded: false, payments: [] });
        render(<ReturnDetailPage />);
        await screen.findByLabelText('bKash amount');
        fireEvent.change(screen.getByDisplayValue('Defective product'), { target: { value: 'Changed reason' } });
        fireEvent.click(screen.getAllByRole('button', { name: /save changes/i })[0]);

        await waitFor(() => expect(getApi().updateReturn).toHaveBeenCalledTimes(1));
        expect(getApi().updateReturn.mock.calls[0][1]).not.toHaveProperty('payments');
    });

    describe('Edit mode', () => {
        beforeEach(() => {
            setEditMode(true);
        });

        it('shows edit mode banner', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByText(/edit mode/i)).toBeInTheDocument();
            });
        });

        it('shows Save Changes button in edit mode', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getAllByRole('button', { name: /save changes/i }).length).toBeGreaterThan(0);
            });
        });

        it('shows reason textarea in edit mode', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/reason for return/i)).toBeInTheDocument();
            });
        });

        it('populates reason field from existing return data', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByDisplayValue('Defective product')).toBeInTheDocument();
            });
        });

        it('shows items table with quantity inputs in edit mode', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByDisplayValue('3')).toBeInTheDocument();
            });
        });

        it('saves with updated reason when Save Changes is clicked', async () => {
            const api = getApi();
            render(<ReturnDetailPage />);
            await waitFor(() => screen.getByDisplayValue('Defective product'));
            fireEvent.change(screen.getByDisplayValue('Defective product'), {
                target: { value: 'Changed reason' },
            });
            fireEvent.click(screen.getAllByRole('button', { name: /save changes/i })[0]);
            await waitFor(() => {
                expect(api.updateReturn).toHaveBeenCalledWith(
                    'ret-1',
                    expect.objectContaining({ reason: 'Changed reason' }),
                );
            });
            expect(pushMock).toHaveBeenCalledWith('/sales/returns/ret-1');
        });

        it('disables Save Changes button when all items have quantity 0', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => screen.getByDisplayValue('3'));
            fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '0' } });
            await waitFor(() => {
                const saveBtn = screen.getAllByRole('button', { name: /save changes/i })[0];
                expect(saveBtn).toBeDisabled();
            });
        });

        it('cancel navigates back to view mode', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => screen.getAllByRole('button', { name: /cancel/i }));
            fireEvent.click(screen.getAllByRole('button', { name: /cancel/i })[0]);
            expect(pushMock).toHaveBeenCalledWith('/sales/returns/ret-1');
        });

        it('shows New Total Refund label in edit mode', async () => {
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByText(/new total refund/i)).toBeInTheDocument();
            });
        });

        it('shows "No items" message when all items removed', async () => {
            const api = getApi();
            api.getReturn.mockResolvedValue({ ...mockReturn, items: [] });
            render(<ReturnDetailPage />);
            await waitFor(() => {
                expect(screen.getByText(/no items.*all removed/i)).toBeInTheDocument();
            });
        });
    });

    describe('printing on the browser’s paper', () => {
        let openSpy: jest.SpyInstance;
        beforeEach(() => {
            openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
        });
        afterEach(() => openSpy.mockRestore());

        it.each([
            ['A5', 'A5'],
            ['Letter', 'Letter'],
            ['Thermal80', 'A4'],
        ] as const)('prints a return chosen as %s on %s, with that paper’s letterhead', async (chosen, printed) => {
            mockBrowserPaper(chosen);
            render(<ReturnDetailPage />);
            fireEvent.click(await screen.findByRole('button', { name: /print preview/i }));
            await waitFor(() => expect(printedPaper()).toEqual({ page: printed, letterhead: printed }));
        });
    });
});
