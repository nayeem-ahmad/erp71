'use client';

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PaymentMethodsSettingsPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/settings/payment-methods',
    useSearchParams: () => ({ get: jest.fn() }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentMethods: jest.fn(),
        getAccounts: jest.fn(),
        createPaymentMethod: jest.fn(),
        updatePaymentMethod: jest.fn(),
        deletePaymentMethod: jest.fn(),
        importPaymentMethods: jest.fn(),
    },
}));

import { api } from '@/lib/api';
import { PAYMENT_METHOD_TYPE_VALUES } from '@erp71/shared-types';

const mockApi = api as jest.Mocked<typeof api>;

const sampleMethods = [
    { id: 'm1', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: true, sort_order: 2 },
    { id: 'm2', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 },
];

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getAccounts.mockResolvedValue([]);
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
});
