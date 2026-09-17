import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminGeneralSettingsPage from './page';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/admin/platform-settings/general'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

function getFetchWithAuth() {
    return require('@/lib/api').fetchWithAuth;
}

const savedSettings = {
    platform_name: 'ERP71',
    support_email: 'support@erp71.com',
    maintenance_mode: 'false',
    demo_enabled: 'true',
};

function demoSwitch() {
    return screen.getByRole('switch', { name: /try demo/i });
}

describe('AdminGeneralSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getFetchWithAuth().mockResolvedValue(savedSettings);
    });

    it('reflects the saved Try Demo setting', async () => {
        render(<AdminGeneralSettingsPage />);

        await waitFor(() => expect(demoSwitch()).toHaveAttribute('aria-checked', 'true'));
        expect(screen.queryByText(/Try Demo is OFF/i)).not.toBeInTheDocument();
    });

    it('shows the switch as off and warns when the demo is disabled', async () => {
        getFetchWithAuth().mockResolvedValue({ ...savedSettings, demo_enabled: 'false' });

        render(<AdminGeneralSettingsPage />);

        await waitFor(() => expect(demoSwitch()).toHaveAttribute('aria-checked', 'false'));
        expect(screen.getByText(/Try Demo is OFF/i)).toBeInTheDocument();
    });

    it('saves demo_enabled as false once the switch is turned off', async () => {
        render(<AdminGeneralSettingsPage />);
        await waitFor(() => expect(demoSwitch()).toBeInTheDocument());

        fireEvent.click(demoSwitch());
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
            const patch = getFetchWithAuth().mock.calls.find(
                ([, init]: [string, any]) => init?.method === 'PATCH',
            );
            expect(patch).toBeDefined();
            expect(JSON.parse(patch[1].body).settings.demo_enabled).toBe('false');
        });
    });

    // An older deployment has no row for the key at all; the page must not read
    // that as "switched off" and then save the demo away on the next save.
    it('treats a missing demo_enabled as on', async () => {
        const { demo_enabled: _omitted, ...withoutDemo } = savedSettings;
        getFetchWithAuth().mockResolvedValue(withoutDemo);

        render(<AdminGeneralSettingsPage />);

        await waitFor(() => expect(demoSwitch()).toHaveAttribute('aria-checked', 'true'));
    });
});
