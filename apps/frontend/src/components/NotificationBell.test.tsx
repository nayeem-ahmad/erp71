import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import NotificationBell from './NotificationBell';

jest.mock('@/lib/api', () => ({
    api: {
        getNotifications: jest.fn(),
        getNotificationUnreadCount: jest.fn(),
        markNotificationRead: jest.fn(),
        markAllNotificationsRead: jest.fn(),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockNotifications = [
    {
        id: 'notif-1',
        type: 'LOW_STOCK',
        title: 'Low stock alert',
        body: 'Widget A is running low',
        link: '/dashboard/inventory',
        read_at: null,
        created_at: new Date(Date.now() - 5 * 60000).toISOString(),
    },
    {
        id: 'notif-2',
        type: 'SUBSCRIPTION_EXPIRY',
        title: 'Subscription expiring',
        body: 'Your subscription expires soon',
        link: '/dashboard/billing',
        read_at: new Date().toISOString(),
        created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    },
    {
        id: 'notif-3',
        type: 'INFO',
        title: 'Info notification',
        body: 'Some general info',
        link: null,
        read_at: null,
        created_at: new Date(Date.now() - 25 * 3600000).toISOString(),
    },
];

describe('NotificationBell', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getNotificationUnreadCount.mockResolvedValue({ count: 0 });
        api.getNotifications.mockResolvedValue(mockNotifications);
        api.markNotificationRead.mockResolvedValue({});
        api.markAllNotificationsRead.mockResolvedValue({});
    });

    it('renders without crashing', () => {
        render(<NotificationBell />);
    });

    it('renders the bell button', () => {
        render(<NotificationBell />);
        expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    });

    it('does not show unread badge when count is 0', async () => {
        render(<NotificationBell />);
        await waitFor(() => {
            expect(screen.queryByText('0')).not.toBeInTheDocument();
        });
    });

    it('shows unread count badge when there are unread notifications', async () => {
        const { api } = require('@/lib/api');
        api.getNotificationUnreadCount.mockResolvedValue({ count: 5 });
        render(<NotificationBell />);
        await waitFor(() => {
            expect(screen.getByText('5')).toBeInTheDocument();
        });
    });

    it('shows 99+ when unread count exceeds 99', async () => {
        const { api } = require('@/lib/api');
        api.getNotificationUnreadCount.mockResolvedValue({ count: 150 });
        render(<NotificationBell />);
        await waitFor(() => {
            expect(screen.getByText('99+')).toBeInTheDocument();
        });
    });

    it('opens notification panel when bell is clicked', async () => {
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByText('Notifications')).toBeInTheDocument();
        });
    });

    it('shows notification list after opening', async () => {
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByText('Low stock alert')).toBeInTheDocument();
            expect(screen.getByText('Subscription expiring')).toBeInTheDocument();
        });
    });

    it('shows empty state when no notifications', async () => {
        const { api } = require('@/lib/api');
        api.getNotifications.mockResolvedValue([]);
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByText('No notifications yet')).toBeInTheDocument();
        });
    });

    it('shows loading state while fetching notifications', async () => {
        const { api } = require('@/lib/api');
        let resolver: (v: any) => void;
        api.getNotifications.mockImplementation(
            () => new Promise((resolve) => { resolver = resolve; })
        );
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows Mark all read button when there are unread notifications', async () => {
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByTitle('Mark all as read')).toBeInTheDocument();
        });
    });

    it('calls markAllNotificationsRead when All read is clicked', async () => {
        const { api } = require('@/lib/api');
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByTitle('Mark all as read')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTitle('Mark all as read'));
        await waitFor(() => {
            expect(api.markAllNotificationsRead).toHaveBeenCalled();
        });
    });

    it('opens panel when bell is clicked', async () => {
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByText('Notifications')).toBeInTheDocument();
        });
    });

    it('calls getNotificationUnreadCount on mount', async () => {
        const { api } = require('@/lib/api');
        render(<NotificationBell />);
        await waitFor(() => {
            expect(api.getNotificationUnreadCount).toHaveBeenCalled();
        });
    });

    it('calls getNotifications when panel opens', async () => {
        const { api } = require('@/lib/api');
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(api.getNotifications).toHaveBeenCalled();
        });
    });

    it('renders notification body text', async () => {
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            expect(screen.getByText('Widget A is running low')).toBeInTheDocument();
        });
    });

    it('handles API error for getNotifications gracefully', async () => {
        const { api } = require('@/lib/api');
        api.getNotifications.mockRejectedValue(new Error('Network error'));
        render(<NotificationBell />);
        fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await waitFor(() => {
            // Should show empty state, not crash
            expect(screen.getByText('No notifications yet')).toBeInTheDocument();
        });
    });
});
