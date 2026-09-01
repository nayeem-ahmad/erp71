'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AdminTenantDetailPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAdminTenant: jest.fn(),
        getAdminTenantNavOverride: jest.fn(),
        getAdminTenantFeatures: jest.fn(),
        updateAdminTenantFeatures: jest.fn(),
        updateAdminTenantSubscription: jest.fn(),
        updateAdminTenantLocalization: jest.fn(),
        setAdminTenantBusinessType: jest.fn(),
        importAdminTenantCatalog: jest.fn(),
        resetAdminTenantNavLayout: jest.fn(),
        getAdminAddonModules: jest.fn(),
        getAdminTenantAddons: jest.fn(),
        grantAdminTenantAddon: jest.fn(),
        revokeAdminTenantAddon: jest.fn(),
        getAdminTenantDemoDataStatus: jest.fn(),
        loadAdminTenantDemoData: jest.fn(),
        suspendTenant: jest.fn(),
        deleteAdminTenant: jest.fn(),
        impersonateTenant: jest.fn(),
        getAdminTenantMessagingIdentity: jest.fn(),
        updateAdminTenantMessagingIdentity: jest.fn(),
        testAdminTenantMessagingEmail: jest.fn(),
        testAdminTenantMessagingWhatsApp: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatDate: (d: string) => d,
    formatBDT: (n: number) => `৳${n}`,
}));

const push = jest.fn();
const replace = jest.fn();
let tabParam: string | null = null;

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, back: jest.fn(), replace }),
    usePathname: () => '/admin/tenants/tenant1',
    useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? tabParam : null) }),
    useParams: () => ({ tenantId: 'tenant1' }),
}));

const mockTenant = {
    id: 'tenant1',
    name: 'Acme Corp',
    created_at: '2024-01-01T00:00:00Z',
    business_type: 'GROCERY',
    localization_enabled: false,
    secondary_locale: null,
    owner: { id: 'u1', email: 'owner@acme.com', name: 'John Doe' },
    stores: [{ id: 'store1', name: 'Main Store', address: '123 Main St' }],
    users: [{ id: 'u1', email: 'owner@acme.com', name: 'John Doe', role: 'OWNER' }],
    store_count: 1,
    user_count: 1,
    ledger_balance: 0,
    subscription: {
        status: 'ACTIVE' as const,
        current_period_start: '2024-01-01T00:00:00Z',
        current_period_end: '2024-02-01T00:00:00Z',
        cancel_at_period_end: false,
        provider_name: 'manual',
        plan: { code: 'BASIC' as const, name: 'Basic Plan', monthly_price: 500, description: null, yearly_price: null },
    },
};

const allOff = {
    feedback: false, support: false, help: false, voice: false,
    manufacturing: true, aiChat: false, externalImport: false, projects: false,
};

describe('AdminTenantDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        tabParam = null;
        const { api } = require('@/lib/api');
        api.getAdminTenant.mockResolvedValue(mockTenant);
        api.getAdminTenantNavOverride.mockResolvedValue(null);
        api.getAdminTenantFeatures.mockResolvedValue({
            platform_defaults: allOff, overrides: {}, effective: allOff,
        });
        api.getAdminAddonModules.mockResolvedValue([]);
        api.getAdminTenantAddons.mockResolvedValue([]);
        api.getAdminTenantDemoDataStatus.mockResolvedValue({ has_demo_data: false });
        api.getAdminTenantMessagingIdentity.mockResolvedValue({
            email_enabled: false, email_from: '', email_from_name: '', email_reply_to: '',
            whatsapp_enabled: false, whatsapp_phone_number_id: '', whatsapp_access_token: '',
            whatsapp_api_version: '', notes: '', updated_at: null, updated_by: null,
        });
    });

    it('renders the tenant name and loads its detail', async () => {
        render(<AdminTenantDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
        });
        expect(require('@/lib/api').api.getAdminTenant).toHaveBeenCalledWith('tenant1');
    });

    it('opens on Overview and shows the stores and users', async () => {
        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        expect(screen.getByText('Main Store')).toBeInTheDocument();
        expect(screen.getAllByText('owner@acme.com').length).toBeGreaterThan(0);
    });

    it('pushes the active tab into the query string', async () => {
        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));

        expect(replace).toHaveBeenCalledWith(
            '/admin/tenants/tenant1?tab=configuration',
            { scroll: false },
        );
    });

    it('renders the tab named by ?tab=', async () => {
        tabParam = 'configuration';
        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        expect(screen.getByText('Feature access')).toBeInTheDocument();
    });

    it('shows no save bar until something is edited', async () => {
        tabParam = 'configuration';
        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByText('Feature access'));

        expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    });

    it('saves per-tenant feature overrides as a tri-state, clearing on Inherit', async () => {
        tabParam = 'configuration';
        const { api } = require('@/lib/api');
        api.getAdminTenantFeatures.mockResolvedValue({
            platform_defaults: allOff,
            overrides: { aiChat: true },
            effective: { ...allOff, aiChat: true },
        });
        api.updateAdminTenantFeatures.mockResolvedValue({
            platform_defaults: allOff,
            overrides: { aiChat: true, voice: true },
            effective: { ...allOff, aiChat: true, voice: true },
        });

        render(<AdminTenantDetailPage />);
        await waitFor(() => expect(screen.getByText('Feature access')).toBeInTheDocument());

        // The unset features show what Inherit currently resolves to.
        expect(screen.getAllByText('Inheriting: On')).toHaveLength(1);   // manufacturing
        expect(screen.getAllByText('Inheriting: Off')).toHaveLength(6);
        expect(screen.getAllByText('Overridden for this tenant.')).toHaveLength(1); // aiChat

        // Pin Voice on for this tenant; every other feature keeps its state.
        const voiceRow = screen.getByText('Voice').closest('div')!.parentElement!;
        fireEvent.click(within(voiceRow).getByRole('button', { name: 'On' }));

        // Editing raises the shared save bar rather than a per-panel button.
        expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateAdminTenantFeatures).toHaveBeenCalledWith('tenant1', {
                feedback: null,
                support: null,
                help: null,
                voice: true,
                manufacturing: null,
                aiChat: true,
                externalImport: null,
                projects: null,
            });
        });
    });

    it('saves only the sections that changed', async () => {
        tabParam = 'subscription';
        const { api } = require('@/lib/api');
        api.updateAdminTenantSubscription.mockResolvedValue({});

        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        fireEvent.change(screen.getByDisplayValue('Basic'), { target: { value: 'PREMIUM' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(api.updateAdminTenantSubscription).toHaveBeenCalledWith('tenant1',
                expect.objectContaining({ planCode: 'PREMIUM' }));
        });
        // Untouched sections must not be written.
        expect(api.updateAdminTenantFeatures).not.toHaveBeenCalled();
        expect(api.updateAdminTenantLocalization).not.toHaveBeenCalled();
        expect(api.setAdminTenantBusinessType).not.toHaveBeenCalled();
    });

    it('discards edits back to the server state', async () => {
        tabParam = 'subscription';
        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        fireEvent.change(screen.getByDisplayValue('Basic'), { target: { value: 'PREMIUM' } });
        expect(screen.getByText('1 unsaved change')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /discard/i }));

        await waitFor(() => {
            expect(screen.queryByText('1 unsaved change')).not.toBeInTheDocument();
        });
        expect(screen.getByDisplayValue('Basic')).toBeInTheDocument();
    });

    it('requires typing the tenant name before deleting', async () => {
        tabParam = 'danger';
        const { api } = require('@/lib/api');
        api.deleteAdminTenant.mockResolvedValue({});

        render(<AdminTenantDetailPage />);
        await waitFor(() => screen.getByRole('heading', { name: 'Acme Corp' }));

        fireEvent.click(screen.getByRole('button', { name: /delete tenant/i }));

        // The dialog's confirm is inert until the name matches.
        const confirm = screen.getAllByRole('button', { name: /delete tenant/i }).pop()!;
        expect(confirm).toBeDisabled();
        expect(api.deleteAdminTenant).not.toHaveBeenCalled();

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme Corp' } });
        fireEvent.click(screen.getAllByRole('button', { name: /delete tenant/i }).pop()!);

        await waitFor(() => {
            expect(api.deleteAdminTenant).toHaveBeenCalledWith('tenant1', 'Deleted by platform admin');
        });
    });
});
