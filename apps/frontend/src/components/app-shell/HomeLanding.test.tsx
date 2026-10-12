import { render, screen } from '@testing-library/react';
import { DEFAULT_PLATFORM_FEATURES, resolveAppStates, type AppStateInput } from '@erp71/shared-types';
import { AppShellProvider, type AppShellValue } from '@/contexts/AppShellContext';
import HomeLanding from './HomeLanding';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, fmt: (s: string) => s }) };
});

const SWITCHES = { ...DEFAULT_PLATFORM_FEATURES, projects: true };

function value(overrides: Partial<AppStateInput>): AppShellValue {
    const input: AppStateInput = {
        planFeatures: {},
        planCode: 'PRO',
        platformFeatures: SWITCHES,
        hiddenApps: [],
        isOwner: false,
        permissions: [],
        ...overrides,
    };
    return {
        enabled: true,
        canManageBilling: false,
        canManageApps: false,
        navGates: {
            appStates: resolveAppStates(input),
            planFeatures: input.planFeatures,
            memberIsOwner: input.isOwner,
            memberPermissions: input.permissions,
        },
    };
}

function renderLanding(shell: AppShellValue) {
    return render(
        <AppShellProvider value={shell}>
            <HomeLanding fallback={<p>loading</p>}>
                <p>dashboard</p>
            </HomeLanding>
        </AppShellProvider>,
    );
}

describe('HomeLanding', () => {
    beforeEach(() => mockReplace.mockReset());

    it('takes a member who can open only one app straight into it', () => {
        renderLanding(value({ permissions: ['VIEW_PROJECTS', 'MANAGE_PROJECT_TASKS', 'LOG_PROJECT_TIME'] }));

        expect(mockReplace).toHaveBeenCalledWith('/projects');
        expect(screen.getByText('loading')).toBeInTheDocument();
        expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    });

    it('leaves a member with several apps on Home', () => {
        renderLanding(value({ permissions: ['VIEW_PROJECTS', 'CREATE_SALE', 'VIEW_SALES'] }));

        expect(mockReplace).not.toHaveBeenCalled();
        expect(screen.getByText('dashboard')).toBeInTheDocument();
    });

    it('always leaves the owner on Home, however many apps are showing', () => {
        renderLanding(value({
            isOwner: true,
            hiddenApps: ['sales', 'storefront', 'purchase', 'imports', 'inventory', 'crm', 'hr'],
        }));

        expect(mockReplace).not.toHaveBeenCalled();
        expect(screen.getByText('dashboard')).toBeInTheDocument();
    });
});
