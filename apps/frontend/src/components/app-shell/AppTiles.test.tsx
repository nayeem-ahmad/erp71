import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    DEFAULT_PLATFORM_FEATURES,
    resolveAppStates,
    type AppStateInput,
} from '@erp71/shared-types';
import { AppShellProvider, type AppShellValue } from '@/contexts/AppShellContext';
import AppTiles from './AppTiles';

const mockGetHomePulse = jest.fn();

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/lib/api', () => ({
    api: { getHomePulse: (...args: unknown[]) => mockGetHomePulse(...args) },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../lib/localization/messages/en');
    const { formatMessage } = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({
            t: enMessages,
            fmt: (template: string, values: Record<string, string | number>) => formatMessage(template, values, 'en'),
        }),
    };
});

jest.mock('@/contexts/NavLayoutContext', () => {
    const { DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT, DEFAULT_TENANT_NAV_LAYOUT } = require('@erp71/shared-types');
    return {
        useNavLayouts: () => ({
            tenantLayout: DEFAULT_TENANT_NAV_LAYOUT,
            platformAdminLayout: DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
        }),
    };
});

const SWITCHES = { ...DEFAULT_PLATFORM_FEATURES, help: true, support: true, manufacturing: true, projects: true };
const PRO = { premiumAccounting: true, premiumManufacturing: true, premiumCrm: true, teamChat: true };

function shell(overrides: Partial<AppStateInput> = {}, value: Partial<AppShellValue> = {}): AppShellValue {
    const input: AppStateInput = {
        planFeatures: PRO,
        planCode: 'PRO',
        platformFeatures: SWITCHES,
        hiddenApps: [],
        isOwner: true,
        permissions: [],
        ...overrides,
    };
    return {
        enabled: true,
        canManageBilling: true,
        canManageApps: true,
        ...value,
        navGates: {
            appStates: resolveAppStates(input),
            planFeatures: input.planFeatures,
            memberIsOwner: input.isOwner,
            memberPermissions: input.permissions,
            canAccessPremiumCrm: true,
            canAccessInventoryReports: true,
            ...value.navGates,
        },
    };
}

function renderTiles(value: AppShellValue) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AppShellProvider value={value}>
                <AppTiles />
            </AppShellProvider>
        </QueryClientProvider>,
    );
}

const tiles = () => screen.getByRole('region', { name: 'Apps' });

describe('AppTiles', () => {
    beforeEach(() => {
        mockGetHomePulse.mockReset();
        mockGetHomePulse.mockResolvedValue({});
    });

    it('shows a tile for each app the workspace uses, in menu order, and none for hidden or unbought apps', () => {
        renderTiles(shell({ hiddenApps: ['crm'], planFeatures: { premiumAccounting: true } }));

        const names = within(tiles()).getAllByRole('link').map((link) => link.textContent);
        expect(names[0]).toContain('Sales');
        expect(names.some((name) => name?.includes('Inventory'))).toBe(true);
        expect(names.some((name) => name?.includes('CRM'))).toBe(false);
        expect(names.some((name) => name?.includes('Manufacturing'))).toBe(false);
    });

    it('puts the waiting work on the tile and links straight to it', async () => {
        mockGetHomePulse.mockResolvedValue({ inventory: { count: 12, href: '/inventory/reports/reorder' } });
        renderTiles(shell());

        const tile = await within(tiles()).findByRole('link', { name: /Inventory.*12 items low on stock/ });
        expect(tile).toHaveAttribute('href', '/inventory/reports/reorder');
        expect(within(tiles()).getByRole('link', { name: /^Sales/ })).toHaveAttribute('href', '/sales');
    });

    it('offers what the plan does not include to whoever can buy it, and not to anyone else', () => {
        const { unmount } = renderTiles(shell({ planCode: 'FREE', planFeatures: {} }));
        // Expenses is sold with Accounting, so it is not offered separately.
        expect(screen.getByRole('button', { name: /Accounting/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Expenses/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Manufacturing/ })).toBeInTheDocument();
        unmount();

        renderTiles(shell({ planCode: 'FREE', planFeatures: {}, isOwner: false, permissions: ['VIEW_SALES'] }, { canManageBilling: false, canManageApps: false }));
        expect(screen.queryByText('Add to your plan')).not.toBeInTheDocument();
    });

    it('explains a locked app and points at billing', () => {
        renderTiles(shell({ planCode: 'FREE', planFeatures: {} }));

        fireEvent.click(screen.getByRole('button', { name: /Manufacturing/ }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Manufacturing is not in your plan')).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: 'See plans and add-ons' })).toHaveAttribute('href', '/billing');
    });

    it('still offers Manage apps when the owner has hidden everything', () => {
        renderTiles(shell({ hiddenApps: ['sales', 'storefront', 'purchase', 'imports', 'accounting', 'expenses', 'inventory', 'crm', 'projects', 'manufacturing', 'hr'] }));

        expect(within(tiles()).queryAllByRole('link').filter((link) => link.getAttribute('href') !== '/settings/apps')).toHaveLength(0);
        expect(screen.getByRole('link', { name: 'Manage apps' })).toHaveAttribute('href', '/settings/apps');
    });

    it('renders nothing while the app shell is off', async () => {
        const { container } = renderTiles(shell({}, { enabled: false }));
        expect(container).toBeEmptyDOMElement();
        await waitFor(() => expect(mockGetHomePulse).not.toHaveBeenCalled());
    });
});
