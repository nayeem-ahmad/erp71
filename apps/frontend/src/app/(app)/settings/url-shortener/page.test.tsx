import { render, screen, waitFor } from '@testing-library/react';
import SettingsUrlShortenerPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getShortLinks: jest.fn(),
        createShortLink: jest.fn(),
        revokeShortLink: jest.fn(),
    },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return { ...actual, useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const BUSINESS = { code: 'PREMIUM', name: 'Business', features_json: { urlShortener: true } };
const GROWTH = { code: 'STANDARD', name: 'Growth', features_json: { urlShortener: false } };

/** One `/auth/me` tenant entry, shaped the way `extractTenantPlan` reads it. */
const tenant = (plan: typeof BUSINESS, role = 'OWNER', permissions: string[] = []) => ({
    id: 'tenant-1',
    name: 'Karim Traders',
    role,
    permissions,
    stores: [],
    subscription: { status: 'ACTIVE', plan },
});

const me = (entry: ReturnType<typeof tenant>) => ({
    id: 'user-1',
    email: 'owner@example.com',
    tenants: [entry],
});

/**
 * The shortener is a Business-plan tool, and every list/create/revoke request
 * 403s below that plan. So the page decides from `/auth/me` before the manager
 * mounts — a lower-plan tenant must get an explanation, never a request that can
 * only fail.
 */
describe('SettingsUrlShortenerPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getShortLinks as jest.Mock).mockResolvedValue([]);
    });

    it('tells an owner below Business that the shortener comes with that plan, and requests no links', async () => {
        (api.getMe as jest.Mock).mockResolvedValue(me(tenant(GROWTH)));

        render(<SettingsUrlShortenerPage />);

        expect(await screen.findByText('Available on the Business plan')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute('href', '/billing');
        expect(api.getShortLinks).not.toHaveBeenCalled();
    });

    it('opens the shortener for a Business owner', async () => {
        (api.getMe as jest.Mock).mockResolvedValue(me(tenant(BUSINESS)));

        render(<SettingsUrlShortenerPage />);

        await waitFor(() => expect(api.getShortLinks).toHaveBeenCalled());
        expect(screen.queryByText('Available on the Business plan')).not.toBeInTheDocument();
    });

    it('tells staff below Business about the plan rather than about permissions', async () => {
        // Granting them the permission would not open anything, so "ask for
        // access" would send them after the wrong fix.
        (api.getMe as jest.Mock).mockResolvedValue(me(tenant(GROWTH, 'MANAGER')));

        render(<SettingsUrlShortenerPage />);

        expect(await screen.findByText('Available on the Business plan')).toBeInTheDocument();
        expect(screen.queryByText('URL shortener restricted')).not.toBeInTheDocument();
    });

    it('still refuses Business staff who lack short-link permission', async () => {
        (api.getMe as jest.Mock).mockResolvedValue(me(tenant(BUSINESS, 'MANAGER')));

        render(<SettingsUrlShortenerPage />);

        expect(await screen.findByText('URL shortener restricted')).toBeInTheDocument();
        expect(api.getShortLinks).not.toHaveBeenCalled();
    });

    it('does not mistake a failed access check for a plan limit', async () => {
        (api.getMe as jest.Mock).mockRejectedValue(new Error('network down'));

        render(<SettingsUrlShortenerPage />);

        expect(await screen.findByText('Could not verify access')).toBeInTheDocument();
        expect(screen.queryByText('Available on the Business plan')).not.toBeInTheDocument();
    });
});
