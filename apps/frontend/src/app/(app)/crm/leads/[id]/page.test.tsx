'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadDetailPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'lead-1' }),
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/crm/CrmActivityPanel', () => ({
    __esModule: true,
    default: () => <div data-testid="activity-panel" />,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getLead: jest.fn(),
        updateLead: jest.fn(),
        getTeamMembers: jest.fn().mockResolvedValue([]),
        getCustomFields: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const lead = {
    id: 'lead-1',
    name: 'Karim Traders',
    mobile: '01700000000',
    email: null,
    status: 'NEW',
    source: 'WALK_IN',
    source_id: 'src-1',
    sourceOption: { id: 'src-1', name: 'Walk-in' },
    category: null,
    category_id: null,
    priority: 'MEDIUM',
    next_step: 'Call back Thursday',
    next_step_date: '2026-09-01T10:00:00.000Z',
    next_step_assigned_to: 'user-9',
    custom_fields: null,
};

describe('LeadDetailPage — save', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getLead.mockResolvedValue(lead);
        api.updateLead.mockResolvedValue({ ...lead, name: 'Karim & Sons' });
    });

    it('does not send next_step fields when saving an edited lead', async () => {
        render(<LeadDetailPage />);

        fireEvent.click(await screen.findByRole('button', { name: /edit lead/i }));
        const nameInput = screen.getByDisplayValue('Karim Traders');
        fireEvent.change(nameInput, { target: { value: 'Karim & Sons' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateLead).toHaveBeenCalled());
        const [, payload] = api.updateLead.mock.calls[0];
        expect(payload.name).toBe('Karim & Sons');
        expect(payload).not.toHaveProperty('next_step');
        expect(payload).not.toHaveProperty('next_step_date');
        expect(payload).not.toHaveProperty('next_step_assigned_to');
    });

    it('does not show next-step inputs on the edit form', async () => {
        render(<LeadDetailPage />);

        fireEvent.click(await screen.findByRole('button', { name: /edit lead/i }));

        // Unique to the edit form (the read-only card uses "Next Step", not this).
        expect(screen.queryByText('Next Step Date')).not.toBeInTheDocument();
        expect(screen.queryByText('Next Step Assigned To')).not.toBeInTheDocument();
    });
});
