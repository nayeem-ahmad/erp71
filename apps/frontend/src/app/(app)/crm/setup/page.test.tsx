import { render, screen, waitFor } from '@testing-library/react';
import CrmSetupPage from './page';

let search = '';
const replace = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/hooks/use-me', () => ({
    fetchMe: jest.fn(() => Promise.resolve({ tenants: [{ id: 't1', role: 'OWNER', permissions: [] }] })),
}));
jest.mock('@/lib/use-tenant-plan-features', () => ({ useTenantPlanFeatures: jest.fn() }));
jest.mock('@/components/crm/CrmListPanel', () => ({
    __esModule: true,
    default: ({ kind }: { kind: string }) => <div data-testid="list-panel">{kind}</div>,
}));
jest.mock('@/components/crm/CrmCustomFieldsPanel', () => ({
    __esModule: true,
    default: () => <div data-testid="custom-fields-panel" />,
}));
jest.mock('@/components/crm/CrmMessageTemplatesPanel', () => ({
    __esModule: true,
    default: () => <div data-testid="templates-panel" />,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useTenantPlanFeatures } = require('@/lib/use-tenant-plan-features');

const planState = (features: Record<string, unknown>, ready = true) => ({
    planCode: null,
    features,
    dashboardPreference: 'AUTO',
    permissions: [],
    role: 'OWNER',
    ready,
});

beforeEach(() => {
    jest.clearAllMocks();
    search = '';
});

describe('CRM Setup', () => {
    it('offers the Message Templates tab on a plan with premium CRM', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({ premiumCrm: true }));
        render(<CrmSetupPage />);

        expect(await screen.findByRole('tab', { name: 'Message Templates' })).toBeInTheDocument();
    });

    /**
     * Every dialog that offers a template is premium CRM, and so is the endpoint.
     * Without the plan the tab could only show an empty list it cannot fill.
     */
    it('leaves the Message Templates tab out without premium CRM', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({ premiumCrm: false }));
        render(<CrmSetupPage />);

        expect(await screen.findByRole('tab', { name: 'Channels' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Message Templates' })).not.toBeInTheDocument();
    });

    it('opens Channels instead when a templates link reaches a tenant without premium CRM', async () => {
        search = 'tab=templates';
        useTenantPlanFeatures.mockReturnValue(planState({}));
        render(<CrmSetupPage />);

        expect(await screen.findByTestId('list-panel')).toHaveTextContent('channels');
        expect(screen.queryByTestId('templates-panel')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true');
    });

    it('opens the templates tab from a link on a plan with premium CRM', async () => {
        search = 'tab=templates';
        useTenantPlanFeatures.mockReturnValue(planState({ premiumCrm: true }));
        render(<CrmSetupPage />);

        expect(await screen.findByTestId('templates-panel')).toBeInTheDocument();
    });

    /** Until the plan is known, a templates link should show neither list rather than flash Channels. */
    it('waits for the plan before deciding what a templates link shows', async () => {
        search = 'tab=templates';
        useTenantPlanFeatures.mockReturnValue(planState({}, false));
        render(<CrmSetupPage />);

        await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
        expect(screen.queryByTestId('templates-panel')).not.toBeInTheDocument();
        expect(screen.queryByTestId('list-panel')).not.toBeInTheDocument();
    });
});
