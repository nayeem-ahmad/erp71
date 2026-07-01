'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CustomersPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getCustomers: jest.fn(),
        createCustomer: jest.fn(),
        getCustomerGroups: jest.fn(),
        getTerritories: jest.fn(),
    },
}));

// DataTable hides `hideOnMobile` columns (customer_code, customer_type,
// customerGroup, segment_category, ...) when this reports a narrow viewport.
// The global matchMedia mock always reports non-matching, so without this the
// desktop-only columns this suite asserts on never render.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const mockCustomers = [
    {
        id: 'cust-1',
        name: 'Alice Smith',
        phone: '01800000001',
        customer_code: 'CUST-001',
        customer_type: 'INDIVIDUAL',
        total_spent: '250.00',
        segment_category: 'VIP',
        created_at: '2026-01-15T08:00:00.000Z',
        customerGroup: { name: 'Wholesale' },
        territory: { name: 'Dhaka North' },
    },
    {
        id: 'cust-2',
        name: 'TechCorp Ltd',
        phone: '01900000002',
        customer_code: null,
        customer_type: 'ORGANIZATION',
        total_spent: '0',
        segment_category: null,
        created_at: '2026-02-01T09:00:00.000Z',
        customerGroup: null,
        territory: null,
    },
];

describe('CustomersPage — Customer Management', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getCustomers.mockResolvedValue(mockCustomers);
        api.createCustomer.mockResolvedValue({ id: 'cust-3' });
        api.getCustomerGroups.mockResolvedValue([{ id: 'grp-1', name: 'Wholesale' }]);
        api.getTerritories.mockResolvedValue([{ id: 'ter-1', name: 'Dhaka North', parent: null }]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Customers page heading', async () => {
        render(<CustomersPage />);
        expect(screen.getByText('Customers')).toBeInTheDocument();
    });

    it('loads and displays customers from the API', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
            expect(screen.getByText('TechCorp Ltd')).toBeInTheDocument();
        });
    });

    it('shows customer phone numbers', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('01800000001')).toBeInTheDocument();
        });
    });

    it('shows customer code when present', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('CUST-001')).toBeInTheDocument();
        });
    });

    it('shows fallback dash when customer code is absent', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            const dashes = screen.getAllByText('-');
            expect(dashes.length).toBeGreaterThan(0);
        });
    });

    it('displays INDIVIDUAL type badge', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('INDIVIDUAL')).toBeInTheDocument();
        });
    });

    it('displays ORGANIZATION type badge', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('ORGANIZATION')).toBeInTheDocument();
        });
    });

    it('shows customer group name when set', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('Wholesale')).toBeInTheDocument();
        });
    });

    it('shows VIP segment badge', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('VIP')).toBeInTheDocument();
        });
    });

    it('shows default GENERAL segment when not set', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            expect(screen.getByText('GENERAL')).toBeInTheDocument();
        });
    });

    it('renders view action link to customer detail page', async () => {
        render(<CustomersPage />);
        await waitFor(() => {
            const link = screen.getAllByRole('link').find(
                (l) => l.getAttribute('href') === '/sales/customers/cust-1',
            );
            expect(link).toBeDefined();
        });
    });

    it('shows New Customer button', () => {
        render(<CustomersPage />);
        expect(screen.getByRole('button', { name: /new customer/i })).toBeInTheDocument();
    });

    it('opens the Add Customer modal when New Customer is clicked', async () => {
        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /new customer/i })).toBeInTheDocument();
        });
    });

    it('modal has name, phone, and email inputs', async () => {
        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));
        await waitFor(() => {
            expect(screen.getByPlaceholderText('John Doe')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('+8801234567890')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('john@example.com')).toBeInTheDocument();
        });
    });

    it('submits the form and calls createCustomer', async () => {
        const { api } = require('@/lib/api');
        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));

        await waitFor(() => screen.getByPlaceholderText('John Doe'));

        fireEvent.change(screen.getByPlaceholderText('John Doe'), {
            target: { value: 'Bob Jones' },
        });
        fireEvent.change(screen.getByPlaceholderText('+8801234567890'), {
            target: { value: '01700000099' },
        });

        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

        await waitFor(() => {
            expect(api.createCustomer).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Bob Jones',
                    phone: '01700000099',
                    customer_type: 'INDIVIDUAL',
                }),
            );
        });
    });

    it('reloads customer list after successful creation', async () => {
        const { api } = require('@/lib/api');
        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));

        await waitFor(() => screen.getByPlaceholderText('John Doe'));
        fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'New Person' } });
        fireEvent.change(screen.getByPlaceholderText('+8801234567890'), { target: { value: '01711111111' } });

        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

        await waitFor(() => {
            // getCustomers is called once on mount and again after successful add
            expect(api.getCustomers).toHaveBeenCalledTimes(2);
        });
    });

    it('closes modal after successful customer creation', async () => {
        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));

        await waitFor(() => screen.getByPlaceholderText('John Doe'));
        fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Eve Adams' } });
        fireEvent.change(screen.getByPlaceholderText('+8801234567890'), { target: { value: '01822222222' } });

        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: /new customer/i })).not.toBeInTheDocument();
        });
    });

    it('shows error in modal when API call fails', async () => {
        const { api } = require('@/lib/api');
        api.createCustomer.mockRejectedValueOnce(new Error('Phone already exists'));

        render(<CustomersPage />);
        fireEvent.click(screen.getByRole('button', { name: /new customer/i }));

        await waitFor(() => screen.getByPlaceholderText('John Doe'));
        fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Dupe Customer' } });
        fireEvent.change(screen.getByPlaceholderText('+8801234567890'), { target: { value: '01800000001' } });

        fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

        await waitFor(() => {
            expect(screen.getByText(/phone already exists/i)).toBeInTheDocument();
        });
    });

    it('calls getCustomers once on initial load', async () => {
        const { api } = require('@/lib/api');
        render(<CustomersPage />);
        await waitFor(() => {
            expect(api.getCustomers).toHaveBeenCalledTimes(1);
        });
    });
});
