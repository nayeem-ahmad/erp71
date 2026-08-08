'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSocialMediaPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAdminSocialPosts: jest.fn(),
        getBufferStatus: jest.fn(),
        getBufferChannels: jest.fn(),
        duplicateAdminSocialPost: jest.fn(),
        deleteAdminSocialPost: jest.fn(),
        pushAdminSocialPost: jest.fn(),
        createAdminSocialPost: jest.fn(),
        updateAdminSocialPost: jest.fn(),
    },
    fetchWithAuth: jest.fn(),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
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
    usePathname: () => '/admin/social-media',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const draft = {
    id: 'post-1',
    status: 'DRAFT',
    title: 'Eid campaign',
    content: 'Eid Mubarak from ERP71',
    link_url: null,
    image_url: null,
    networks: ['facebook'],
    scheduled_for: null,
    published_at: null,
    author_name: 'Nayeem',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    pushes: [],
    last_push_at: null,
};

const sent = {
    ...draft,
    id: 'post-2',
    status: 'PUBLISHED',
    title: 'Launch note',
    content: 'ERP71 v2 is live',
    pushes: [
        {
            id: 'push-1',
            channel_id: 'chan-fb',
            channel_name: 'ERP71 BD',
            channel_service: 'facebook',
            mode: 'addToQueue',
            due_at: null,
            status: 'SENT',
            external_post_id: 'buffer-1',
            error: null,
            created_at: '2026-08-02T10:00:00.000Z',
        },
    ],
    last_push_at: '2026-08-02T10:00:00.000Z',
};

describe('AdminSocialMediaPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getAdminSocialPosts.mockResolvedValue({ rows: [draft, sent], total: 2, page: 1, limit: 20 });
        api.getBufferStatus.mockResolvedValue({ configured: true, default_channel_id: 'chan-fb' });
        api.getBufferChannels.mockResolvedValue([
            { id: 'chan-fb', name: 'ERP71 BD', service: 'facebook', avatar: null, isQueuePaused: false },
        ]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('lists posts with their status', async () => {
        render(<AdminSocialMediaPage />);

        await waitFor(() => {
            expect(screen.getByText('Eid campaign')).toBeInTheDocument();
        });
        expect(screen.getByText('Launch note')).toBeInTheDocument();
        // Twice: once as the status filter option, once as the row's badge.
        expect(screen.getAllByText('Sent to Buffer')).toHaveLength(2);
    });

    it('warns when Buffer is not connected', async () => {
        const { api } = require('@/lib/api');
        api.getBufferStatus.mockResolvedValue({ configured: false, default_channel_id: null });

        render(<AdminSocialMediaPage />);

        await waitFor(() => {
            expect(screen.getByText(/Buffer is not connected yet/)).toBeInTheDocument();
        });
    });

    it('does not warn when the Buffer probe itself fails', async () => {
        // A flaky request must not put a setup banner in front of a working install.
        const { api } = require('@/lib/api');
        api.getBufferStatus.mockRejectedValue(new Error('network'));

        render(<AdminSocialMediaPage />);

        await waitFor(() => {
            expect(screen.getByText('Eid campaign')).toBeInTheDocument();
        });
        expect(screen.queryByText(/Buffer is not connected yet/)).not.toBeInTheDocument();
    });

    it('offers no edit action on a post already sent to Buffer', async () => {
        render(<AdminSocialMediaPage />);

        await waitFor(() => {
            expect(screen.getByText('Launch note')).toBeInTheDocument();
        });
        // One editable draft, one sent post that is push/duplicate/delete only.
        expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Push to Buffer' })).toHaveLength(2);
    });

    it('opens the push modal with the default channel preselected', async () => {
        render(<AdminSocialMediaPage />);
        await waitFor(() => expect(screen.getByText('Eid campaign')).toBeInTheDocument());

        fireEvent.click(screen.getAllByRole('button', { name: 'Push to Buffer' })[0]);

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });
        const checkbox = await screen.findByRole('checkbox');
        expect(checkbox).toBeChecked();
    });

    it('pushes the selected channel and reports the result', async () => {
        const { api } = require('@/lib/api');
        api.pushAdminSocialPost.mockResolvedValue({ post: { ...draft, status: 'PUBLISHED' }, sent: 1, failed: 0 });
        const { toast } = require('@/lib/toast');

        render(<AdminSocialMediaPage />);
        await waitFor(() => expect(screen.getByText('Eid campaign')).toBeInTheDocument());
        fireEvent.click(screen.getAllByRole('button', { name: 'Push to Buffer' })[0]);
        await screen.findByRole('checkbox');

        fireEvent.click(screen.getByRole('button', { name: 'Push' }));

        await waitFor(() => {
            expect(api.pushAdminSocialPost).toHaveBeenCalledWith('post-1', {
                channel_ids: ['chan-fb'],
                mode: 'addToQueue',
                due_at: null,
            });
        });
        expect(toast.success).toHaveBeenCalledWith('Sent to 1 channel(s).');
    });

    it('reports a partial push as an error rather than a success', async () => {
        const { api } = require('@/lib/api');
        api.pushAdminSocialPost.mockResolvedValue({ post: draft, sent: 1, failed: 2 });
        const { toast } = require('@/lib/toast');

        render(<AdminSocialMediaPage />);
        await waitFor(() => expect(screen.getByText('Eid campaign')).toBeInTheDocument());
        fireEvent.click(screen.getAllByRole('button', { name: 'Push to Buffer' })[0]);
        await screen.findByRole('checkbox');

        fireEvent.click(screen.getByRole('button', { name: 'Push' }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Sent to 1 channel(s); 2 failed.');
        });
        expect(toast.success).not.toHaveBeenCalled();
    });
});
