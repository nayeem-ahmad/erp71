'use client';

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PaymentMethodsSettingsPage from './page';
import { MOCK_BRANCHES, mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/settings/payment-methods',
    useSearchParams: () => ({ get: jest.fn() }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentMethods: jest.fn(),
        getPaymentMethodAccounts: jest.fn(),
        getStores: jest.fn(),
        createPaymentMethod: jest.fn(),
        updatePaymentMethod: jest.fn(),
        deletePaymentMethod: jest.fn(),
        importPaymentMethods: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { PAYMENT_METHOD_TYPE_VALUES } from '@erp71/shared-types';

const mockApi = api as jest.Mocked<typeof api>;
const mockToast = toast as jest.Mocked<typeof toast>;

const sampleMethods = [
    { id: 'm1', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 2 },
    { id: 'm2', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 },
];

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getPaymentMethodAccounts.mockResolvedValue([]);
    mockApi.getStores.mockResolvedValue(MOCK_BRANCHES);
    mockBranchScope();
});

describe('PaymentMethodsSettingsPage', () => {
    it('renders the page heading', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        render(<PaymentMethodsSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Payment Methods' })).toBeInTheDocument();
        });
    });

    it('sorts the methods list by sort_order asc', async () => {
        mockApi.getPaymentMethods.mockResolvedValue(sampleMethods);
        const { container } = render(<PaymentMethodsSettingsPage />);
        await waitFor(() => {
            expect(container.querySelectorAll('.text-sm.font-bold.text-gray-900')).toHaveLength(2);
        });
        const names = Array.from(container.querySelectorAll('.text-sm.font-bold.text-gray-900')).map(
            (el) => el.textContent,
        );
        expect(names).toEqual(['Cash', 'bKash']);
    });

    it('creates a payment method with show_on_entry and sort_order from the form', async () => {
        mockApi.getPaymentMethods
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        mockApi.createPaymentMethod.mockResolvedValue({ id: 'new-1' });
        render(<PaymentMethodsSettingsPage />);
        await waitFor(() => expect(screen.getByText('No payment methods yet')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Add Method'));

        fireEvent.change(screen.getByPlaceholderText('e.g. bKash, Main Cash'), {
            target: { value: 'Nagad' },
        });

        // Toggle "Show on Entry UI" off
        fireEvent.click(screen.getByText('Show on Entry UI').previousElementSibling as Element);

        // Set Serial to 3
        fireEvent.change(screen.getByPlaceholderText('e.g. 1'), {
            target: { value: '3' },
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });

        await waitFor(() => {
            expect(mockApi.createPaymentMethod).toHaveBeenCalledWith(
                expect.objectContaining({ show_on_entry: false, sort_order: 3 }),
            );
        });
    });

    // Regression: the form used to send 'CASH'/'MOBILE_WALLET' while the backend
    // DTO validates against the PaymentMethodType *values* ('Cash', 'Mobile
    // Wallet', ...). Every create 400'd, so no tenant ever had payment methods.
    it('submits a type the backend PaymentMethodType contract accepts', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        mockApi.createPaymentMethod.mockResolvedValue({} as never);
        render(<PaymentMethodsSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /add method/i }));
        fireEvent.change(screen.getByPlaceholderText('e.g. bKash, Main Cash'), {
            target: { value: 'Main Till' },
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
        });

        await waitFor(() => expect(mockApi.createPaymentMethod).toHaveBeenCalled());
        const payload = mockApi.createPaymentMethod.mock.calls[0][0] as { type: string };
        expect(PAYMENT_METHOD_TYPE_VALUES).toContain(payload.type);
    });

    // Regression: the page loaded methods and accounts in one Promise.all, so the
    // entitlement-gated accounts call ("This feature requires an active
    // subscription.") rejected the batch and left the list blank for every tenant
    // without the accounting module.
    it('still renders the methods list when the accounts lookup fails', async () => {
        mockApi.getPaymentMethods.mockResolvedValue(sampleMethods);
        mockApi.getPaymentMethodAccounts.mockRejectedValue(
            new Error('This feature requires an active subscription.'),
        );

        const { container } = render(<PaymentMethodsSettingsPage />);

        await waitFor(() => {
            expect(container.querySelectorAll('.text-sm.font-bold.text-gray-900')).toHaveLength(2);
        });
        expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('explains an empty account picker when the accounts lookup failed', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        mockApi.getPaymentMethodAccounts.mockRejectedValue(new Error('403'));

        render(<PaymentMethodsSettingsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /add method/i }));

        expect(screen.getByText(/Accounts could not be loaded/i)).toBeInTheDocument();
    });

    it('populates the account picker from the ungated payment-method lookup', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        mockApi.getPaymentMethodAccounts.mockResolvedValue([
            { id: 'acc-1', name: 'Cash in Hand', code: '110101', type: 'asset', category: 'cash' },
        ]);

        render(<PaymentMethodsSettingsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /add method/i }));

        fireEvent.click(await screen.findByLabelText('Account'));
        expect(await screen.findByRole('option', { name: /Cash in Hand/ })).toBeInTheDocument();
    });

    // Regression: the form sent `undefined` for "no account linked", which the
    // backend reads as "leave it alone" — an existing link could never be cleared.
    it('sends an explicit null when no account is linked', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        mockApi.createPaymentMethod.mockResolvedValue({} as never);

        render(<PaymentMethodsSettingsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /add method/i }));
        fireEvent.change(screen.getByPlaceholderText('e.g. bKash, Main Cash'), {
            target: { value: 'Main Till' },
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
        });

        await waitFor(() => expect(mockApi.createPaymentMethod).toHaveBeenCalled());
        expect(mockApi.createPaymentMethod.mock.calls[0][0]).toMatchObject({ account_id: null });
    });

    it('shows the linked account name next to the method type', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([
            { id: 'm1', name: 'Main Till', type: 'Cash', account_id: 'acc-1', is_active: true, show_on_entry: true, sort_order: 1 },
        ]);
        mockApi.getPaymentMethodAccounts.mockResolvedValue([
            { id: 'acc-1', name: 'Cash in Hand', code: '110101', type: 'asset', category: 'cash' },
        ]);

        render(<PaymentMethodsSettingsPage />);

        expect(await screen.findByText(/Cash · Cash in Hand/)).toBeInTheDocument();
    });

    it('offers every shared PaymentMethodType value as a selectable option', async () => {
        mockApi.getPaymentMethods.mockResolvedValue([]);
        render(<PaymentMethodsSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /add method/i }));
        const options = screen
            .getAllByRole('option')
            .map((o) => (o as HTMLOptionElement).value);

        for (const value of PAYMENT_METHOD_TYPE_VALUES) {
            expect(options).toContain(value);
        }
    });

    describe('branches', () => {
        const nameInput = () => screen.getByPlaceholderText('e.g. bKash, Main Cash');
        const openCreate = async () => {
            fireEvent.click(await screen.findByRole('button', { name: /add method/i }));
            await screen.findByLabelText('All branches');
        };
        const submit = async () => {
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
            });
        };

        it('shows an All branches checkbox, checked by default, and a branch checklist when unchecked', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            render(<PaymentMethodsSettingsPage />);
            await openCreate();

            const all = screen.getByLabelText('All branches') as HTMLInputElement;
            expect(all.checked).toBe(true);
            expect(screen.queryByLabelText('Dhaka Branch')).not.toBeInTheDocument();

            fireEvent.click(all);
            expect(screen.getByLabelText('Dhaka Branch')).toBeInTheDocument();
            expect(screen.getByLabelText('Chattogram Branch')).toBeInTheDocument();
        });

        it('sends all_branches true by default', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            mockApi.createPaymentMethod.mockResolvedValue({} as never);
            render(<PaymentMethodsSettingsPage />);
            await openCreate();
            fireEvent.change(nameInput(), { target: { value: 'Main Till' } });
            await submit();

            await waitFor(() => expect(mockApi.createPaymentMethod).toHaveBeenCalled());
            expect(mockApi.createPaymentMethod.mock.calls[0][0]).toMatchObject({
                all_branches: true,
                store_ids: [],
            });
        });

        it('saves all_branches false with the ticked store_ids', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            mockApi.createPaymentMethod.mockResolvedValue({} as never);
            render(<PaymentMethodsSettingsPage />);
            await openCreate();
            fireEvent.change(nameInput(), { target: { value: 'Main Till' } });
            fireEvent.click(screen.getByLabelText('All branches'));
            fireEvent.click(screen.getByLabelText('Chattogram Branch'));
            await submit();

            await waitFor(() => expect(mockApi.createPaymentMethod).toHaveBeenCalled());
            expect(mockApi.createPaymentMethod.mock.calls[0][0]).toMatchObject({
                all_branches: false,
                store_ids: ['store-2'],
            });
        });

        it('refuses to save with All branches off and no branch ticked', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            render(<PaymentMethodsSettingsPage />);
            await openCreate();
            fireEvent.change(nameInput(), { target: { value: 'Main Till' } });
            fireEvent.click(screen.getByLabelText('All branches'));
            await submit();

            expect(await screen.findByText('Pick at least one branch')).toBeInTheDocument();
            expect(mockApi.createPaymentMethod).not.toHaveBeenCalled();
            expect(mockToast.error).not.toHaveBeenCalled();

            // Ticking a branch clears the message.
            fireEvent.click(screen.getByLabelText('Dhaka Branch'));
            expect(screen.queryByText('Pick at least one branch')).not.toBeInTheDocument();
        });

        it('edits a branch-limited method with its branches ticked', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([
                { id: 'm1', name: 'Dhaka Till', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1, all_branches: false, store_ids: ['store-1'] },
            ]);
            mockApi.updatePaymentMethod.mockResolvedValue({} as never);
            render(<PaymentMethodsSettingsPage />);

            fireEvent.click(await screen.findByTitle('Edit'));
            expect((await screen.findByLabelText('All branches') as HTMLInputElement).checked).toBe(false);
            expect((screen.getByLabelText('Dhaka Branch') as HTMLInputElement).checked).toBe(true);
            expect((screen.getByLabelText('Chattogram Branch') as HTMLInputElement).checked).toBe(false);

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /^update$/i }));
            });
            await waitFor(() => expect(mockApi.updatePaymentMethod).toHaveBeenCalled());
            expect(mockApi.updatePaymentMethod.mock.calls[0][1]).toMatchObject({
                all_branches: false,
                store_ids: ['store-1'],
            });
        });

        it('shows a Branches column with branch names or "All branches"', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([
                { id: 'm1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1, all_branches: true, store_ids: [] },
                { id: 'm2', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 2, all_branches: false, store_ids: ['store-1', 'store-2'] },
            ]);
            render(<PaymentMethodsSettingsPage />);

            expect(await screen.findByText('Branches: All branches')).toBeInTheDocument();
            expect(screen.getByText('Branches: Dhaka Branch, Chattogram Branch')).toBeInTheDocument();
        });

        it('hides the field on a single-branch tenant', async () => {
            mockApi.getStores.mockResolvedValue([MOCK_BRANCHES[0]]);
            mockApi.getPaymentMethods.mockResolvedValue([
                { id: 'm1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1, all_branches: true, store_ids: [] },
            ]);
            mockApi.createPaymentMethod.mockResolvedValue({} as never);
            render(<PaymentMethodsSettingsPage />);

            fireEvent.click(await screen.findByRole('button', { name: /add method/i }));
            await screen.findByPlaceholderText('e.g. bKash, Main Cash');
            expect(screen.queryByLabelText('All branches')).not.toBeInTheDocument();
            expect(screen.queryByText(/^Branches:/)).not.toBeInTheDocument();

            fireEvent.change(nameInput(), { target: { value: 'Main Till' } });
            await submit();
            await waitFor(() => expect(mockApi.createPaymentMethod).toHaveBeenCalled());
        });

        it('lists methods for the header branch', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            render(<PaymentMethodsSettingsPage />);

            await waitFor(() => expect(mockApi.getPaymentMethods).toHaveBeenCalledWith(undefined, 'store-1'));
        });

        it('lists every branch under All branches and refetches when the filter changes', async () => {
            mockApi.getPaymentMethods.mockResolvedValue([]);
            render(<PaymentMethodsSettingsPage />);
            await waitFor(() => expect(mockApi.getPaymentMethods).toHaveBeenCalledWith(undefined, 'store-1'));

            fireEvent.change(await screen.findByTestId('branch-filter'), { target: { value: 'all' } });
            await waitFor(() => expect(mockApi.getPaymentMethods).toHaveBeenCalledWith(undefined, 'all'));
        });
    });
});
