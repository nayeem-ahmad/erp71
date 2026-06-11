'use client';

import { render, screen, waitFor } from '@testing-library/react';
import DeliveryPage from './page';

jest.mock('../../../lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/delivery',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockOrders = [
    {
        id: 'del-1',
        saleId: 'sale-1',
        customerName: 'Rahim Uddin',
        customerPhone: '01700000001',
        deliveryAddress: '123 Main Street, Dhaka',
        driverName: 'Karim',
        driverPhone: '01800000001',
        status: 'IN_TRANSIT',
        scheduledAt: '2026-06-15T10:00:00.000Z',
        deliveredAt: null,
        created_at: '2026-06-10T08:00:00.000Z',
    },
    {
        id: 'del-2',
        saleId: null,
        customerName: 'Sumaiya Begum',
        customerPhone: null,
        deliveryAddress: '456 Side Road, Chittagong',
        driverName: null,
        driverPhone: null,
        status: 'PENDING',
        scheduledAt: null,
        deliveredAt: null,
        created_at: '2026-06-11T09:00:00.000Z',
    },
];

describe('DeliveryPage', () => {
    beforeEach(() => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue({ items: mockOrders, total: 2, pages: 1 });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Delivery Orders heading', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('Delivery Orders')).toBeInTheDocument();
        });
    });

    it('displays delivery orders loaded from the API', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
            expect(screen.getByText('Sumaiya Begum')).toBeInTheDocument();
        });
    });

    it('displays delivery address', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('123 Main Street, Dhaka')).toBeInTheDocument();
        });
    });

    it('displays driver name when assigned', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('Karim')).toBeInTheDocument();
        });
    });

    it('shows Unassigned when no driver', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('Unassigned')).toBeInTheDocument();
        });
    });

    it('renders status badges', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('IN TRANSIT')).toBeInTheDocument();
            expect(screen.getByText('PENDING')).toBeInTheDocument();
        });
    });

    it('renders the New Delivery button', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('New Delivery')).toBeInTheDocument();
        });
    });

    it('shows empty state when no delivery orders exist', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        fetchWithAuth.mockResolvedValue({ items: [], total: 0, pages: 1 });
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('No delivery orders yet')).toBeInTheDocument();
        });
    });

    it('renders status filter tabs', async () => {
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(screen.getByText('All')).toBeInTheDocument();
            expect(screen.getByText('Pending')).toBeInTheDocument();
            expect(screen.getByText('Delivered')).toBeInTheDocument();
        });
    });

    it('calls fetchWithAuth on mount', async () => {
        const { fetchWithAuth } = require('../../../lib/api');
        render(<DeliveryPage />);
        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledTimes(1);
        });
    });
});
