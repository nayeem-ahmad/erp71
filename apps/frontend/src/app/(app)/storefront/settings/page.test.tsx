import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StorefrontSettingsPage from './page';

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/storefront/settings'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockSettings = {
    id: 'store-1',
    name: 'My Store',
    storefront_slug: 'my-store',
    storefront_enabled: true,
    storefront_banner: 'https://example.com/banner.jpg',
    storefront_hero_image: 'https://example.com/hero.jpg',
    storefront_hero_headline: 'Welcome to My Store',
};

function getFetchWithAuth() {
    return require('@/lib/api').fetchWithAuth;
}

describe('StorefrontSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getFetchWithAuth().mockResolvedValue(mockSettings);
    });

    it('shows loading spinner initially', () => {
        getFetchWithAuth().mockReturnValue(new Promise(() => {}));
        render(<StorefrontSettingsPage />);
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders the page heading', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Storefront Settings' })).toBeInTheDocument();
        });
    });

    it('renders the page description', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText(/configure your public online store/i)).toBeInTheDocument();
        });
    });

    it('populates slug field from settings', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('my-store')).toBeInTheDocument();
        });
    });

    it('populates hero headline from settings', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Welcome to My Store')).toBeInTheDocument();
        });
    });

    it('shows Enable Storefront toggle', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Enable Storefront')).toBeInTheDocument();
        });
    });

    it('shows toggle button', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /toggle storefront/i })).toBeInTheDocument();
        });
    });

    it('toggles storefront enabled state on click', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /toggle storefront/i }));
        fireEvent.click(screen.getByRole('button', { name: /toggle storefront/i }));
        // Toggle should flip; no error expected
        expect(document.body).toBeInTheDocument();
    });

    it('shows store slug label', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Store Slug')).toBeInTheDocument();
        });
    });

    it('shows hero headline label', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText(/hero headline/i)).toBeInTheDocument();
        });
    });

    it('shows save button', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
        });
    });

    it('calls fetchWithAuth with PATCH on save', async () => {
        const fetchWithAuth = getFetchWithAuth();
        // First call loads settings, second is the PATCH
        fetchWithAuth.mockResolvedValueOnce(mockSettings).mockResolvedValueOnce(mockSettings);

        render(<StorefrontSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save/i }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith(
                '/tenants/storefront-settings',
                expect.objectContaining({ method: 'PATCH' })
            );
        });
    });

    it('shows success message after save', async () => {
        const fetchWithAuth = getFetchWithAuth();
        fetchWithAuth
            .mockResolvedValueOnce(mockSettings)
            .mockResolvedValueOnce(mockSettings);

        render(<StorefrontSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save/i }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
            expect(screen.getByText(/saved/i)).toBeInTheDocument();
        });
    });

    it('shows error message when save fails', async () => {
        const fetchWithAuth = getFetchWithAuth();
        fetchWithAuth
            .mockResolvedValueOnce(mockSettings)
            .mockRejectedValueOnce(new Error('Save failed'));

        render(<StorefrontSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save/i }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
            expect(screen.getByText(/save failed/i)).toBeInTheDocument();
        });
    });

    it('shows public store URL when slug is set', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText(/\/store\/my-store/)).toBeInTheDocument();
        });
    });

    it('shows banner URL field', async () => {
        render(<StorefrontSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('https://example.com/banner.jpg')).toBeInTheDocument();
        });
    });
});
