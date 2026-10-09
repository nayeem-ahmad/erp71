import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_PLATFORM_FEATURES, resolveAppStates, type AppStateInput } from '@erp71/shared-types';
import { AppShellProvider, type AppShellValue } from '@/contexts/AppShellContext';
import { ME_QUERY_KEY } from '@/lib/query-client';
import AppsSettingsPage from './page';

const mockGetSettings = jest.fn();
const mockUpdateSettings = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/lib/api', () => ({
    api: {
        getTenantAppSettings: (...args: unknown[]) => mockGetSettings(...args),
        updateTenantAppSettings: (...args: unknown[]) => mockUpdateSettings(...args),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
    const { formatMessage } = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({
            t: enMessages,
            fmt: (template: string, values: Record<string, string | number>) => formatMessage(template, values, 'en'),
        }),
    };
});

// Manufacturing's switch is off platform-wide; everything else is on.
const SWITCHES = { ...DEFAULT_PLATFORM_FEATURES, projects: true, manufacturing: false };

function shell(overrides: Partial<AppStateInput> = {}, canManageApps = true): AppShellValue {
    const input: AppStateInput = {
        // No accounting entitlement: Accounting and Expenses are locked.
        planFeatures: {},
        planCode: 'PRO',
        platformFeatures: SWITCHES,
        hiddenApps: ['crm'],
        isOwner: true,
        permissions: [],
        ...overrides,
    };
    return {
        enabled: true,
        canManageBilling: true,
        canManageApps,
        navGates: { appStates: resolveAppStates(input), planFeatures: input.planFeatures, memberIsOwner: input.isOwner },
    };
}

function renderPage(value: AppShellValue) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <AppShellProvider value={value}>
                <AppsSettingsPage />
            </AppShellProvider>
        </QueryClientProvider>,
    );
    return { invalidate };
}

describe('Apps settings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSettings.mockResolvedValue({ hidden_apps: ['crm'] });
        mockUpdateSettings.mockImplementation(async ({ hidden_apps }) => ({ hidden_apps }));
    });

    it('lists the apps the workspace can show or hide, the ones it could buy, and nothing switched off', async () => {
        renderPage(shell());

        const sales = await screen.findByRole('switch', { name: 'Show Sales' });
        expect(sales).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Show CRM' })).toHaveAttribute('aria-checked', 'false');

        expect(screen.queryByRole('switch', { name: 'Show Accounting' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'See plans and add-ons' })[0]).toHaveAttribute('href', '/billing');

        expect(screen.queryByText('Manufacturing')).not.toBeInTheDocument();
    });

    it('saves the whole hidden list and refreshes the session so the rail follows', async () => {
        const { invalidate } = renderPage(shell());

        fireEvent.click(await screen.findByRole('switch', { name: 'Show Inventory' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ hidden_apps: ['crm', 'inventory'] }));
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
        expect(mockToastSuccess).toHaveBeenCalledWith('App list saved.');
    });

    it('lets everyone else look but not change', async () => {
        renderPage(shell({}, false));

        expect(await screen.findByRole('switch', { name: 'Show Sales' })).toBeDisabled();
        expect(screen.getByText('Only an owner or manager can change which apps the workspace shows.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });

    it('keeps the edit and says so when saving fails', async () => {
        mockUpdateSettings.mockRejectedValue(new Error('Network down'));
        renderPage(shell());

        const inventory = await screen.findByRole('switch', { name: 'Show Inventory' });
        fireEvent.click(inventory);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Network down'));
        expect(inventory).toHaveAttribute('aria-checked', 'false');
    });

    it('changes nothing until the saved list has loaded, so a stale list cannot overwrite it', async () => {
        let resolveLoad: (value: { hidden_apps: string[] }) => void = () => undefined;
        mockGetSettings.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
        renderPage(shell());

        expect(screen.getByRole('switch', { name: 'Show Sales' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        resolveLoad({ hidden_apps: ['crm'] });
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Show Sales' })).toBeEnabled());
    });

    it('stays read-only when the saved list cannot be loaded', async () => {
        mockGetSettings.mockRejectedValue(new Error('offline'));
        renderPage(shell());

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Could not load the app list.'));
        expect(screen.getByRole('switch', { name: 'Show Sales' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
});
