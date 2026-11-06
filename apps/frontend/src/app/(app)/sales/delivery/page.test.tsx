'use client';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import DeliveryPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ tenants: [] }),
        getDeliveriesList: jest.fn(),
        getDeliveriesListSummary: jest.fn(),
        getDeliveryDrivers: jest.fn(),
        createDelivery: jest.fn(),
        updateDelivery: jest.fn(),
        cancelDelivery: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/sales/delivery',
    useSearchParams: () => new URLSearchParams(),
}));

// Desktop width: the one-row filter toolbar (the phone gets a sheet instead).
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

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
        sale: { id: 'sale-1', serial_number: 'INV-00042' },
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
        sale: null,
    },
];

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20, pages: 1 });

/** A filter chip on the toolbar row — a button that opens its own popover. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

describe('DeliveryPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getDeliveriesList.mockResolvedValue(page(mockOrders));
        api.getDeliveriesListSummary.mockResolvedValue({
            count: 9,
            pending: 3,
            inTransit: 2,
            delivered: 3,
            failed: 1,
            cancelled: 0,
            overdue: 2,
            unassigned: 1,
        });
        api.getDeliveryDrivers.mockResolvedValue(['Karim', 'Selim']);
    });

    it('renders the Delivery Orders heading and the New Delivery action', async () => {
        renderWithQueryClient(<DeliveryPage />);
        expect(await screen.findByRole('heading', { name: 'Delivery Orders' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New Delivery/ })).toBeInTheDocument();
    });

    it('lists deliveries with address, driver, the sale and translated statuses', async () => {
        renderWithQueryClient(<DeliveryPage />);
        expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument();
        expect(screen.getByText('Sumaiya Begum')).toBeInTheDocument();
        expect(screen.getByText('123 Main Street, Dhaka')).toBeInTheDocument();
        expect(screen.getByText('Karim')).toBeInTheDocument();
        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'INV-00042' })).toHaveAttribute('href', '/sales/sale-1');
        expect(screen.getAllByText('In transit').length).toBeGreaterThan(0);
        expect(screen.queryByText('IN_TRANSIT')).not.toBeInTheDocument();
    });

    it('shows the empty state when no delivery orders exist', async () => {
        const { api } = require('@/lib/api');
        api.getDeliveriesList.mockResolvedValue(page([]));
        renderWithQueryClient(<DeliveryPage />);
        expect(await screen.findByText('No delivery orders yet')).toBeInTheDocument();
    });

    it('shows the strip for the filtered deliveries, overdue and unassigned included', async () => {
        renderWithQueryClient(<DeliveryPage />);
        const strip = await screen.findByRole('region', { name: 'Deliveries summary' });
        await within(strip).findByText('9');
        expect(within(strip).getByText('· 1 unassigned')).toBeInTheDocument();
        expect(within(strip).getByText('Overdue')).toBeInTheDocument();
        expect(within(strip).getByText('· 33%')).toBeInTheDocument();
    });

    it('filters status (and its inverse) and driver on the server, for rows and strip alike', async () => {
        const { api } = require('@/lib/api');
        renderWithQueryClient(<DeliveryPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Delivered' }));
        await waitFor(() =>
            expect(api.getDeliveriesList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'DELIVERED' })),
        );
        expect(api.getDeliveriesListSummary).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DELIVERED' }));

        fireEvent.click(chip('Driver'));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Unassigned' }));
        await waitFor(() =>
            expect(api.getDeliveriesList).toHaveBeenLastCalledWith(expect.objectContaining({ drivers: ['none'] })),
        );
    });

    it('keeps Created behind More', async () => {
        renderWithQueryClient(<DeliveryPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(chip(/^More/));
        const more = screen.getByRole('dialog', { name: 'More' });
        expect(within(more).getByRole('button', { name: /^Created/ })).toBeInTheDocument();
    });

    it('cancels through the app\'s own confirmation, then refreshes rows and strip', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.cancelDelivery.mockResolvedValue(undefined);
        const confirmSpy = jest.spyOn(window, 'confirm');
        renderWithQueryClient(<DeliveryPage />);
        await screen.findByText('Rahim Uddin');
        const listCalls = api.getDeliveriesList.mock.calls.length;
        const summaryCalls = api.getDeliveriesListSummary.mock.calls.length;

        fireEvent.click(screen.getAllByRole('button', { name: 'Cancel delivery' })[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel delivery' }));

        await waitFor(() => expect(api.cancelDelivery).toHaveBeenCalledWith('del-1'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Delivery cancelled'));
        await waitFor(() => expect(api.getDeliveriesList.mock.calls.length).toBeGreaterThan(listCalls));
        expect(api.getDeliveriesListSummary.mock.calls.length).toBeGreaterThan(summaryCalls);
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('marks an open delivery delivered in one click', async () => {
        const { api } = require('@/lib/api');
        api.updateDelivery.mockResolvedValue({});
        renderWithQueryClient(<DeliveryPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(screen.getAllByRole('button', { name: 'Mark delivered' })[0]);

        await waitFor(() => expect(api.updateDelivery).toHaveBeenCalledWith('del-1', { status: 'DELIVERED' }));
    });

    it('asks for the customer and address inline rather than with an alert', async () => {
        const { api } = require('@/lib/api');
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
        renderWithQueryClient(<DeliveryPage />);
        await screen.findByText('Rahim Uddin');

        fireEvent.click(screen.getByRole('button', { name: /New Delivery/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Customer name and delivery address are required.');
        expect(api.createDelivery).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });
});
