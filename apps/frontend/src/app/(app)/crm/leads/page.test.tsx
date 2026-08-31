'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadsPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

// DataTable drops `hideOnMobile` columns when this reports a narrow viewport,
// and the global matchMedia mock always reports non-matching.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getLeads: jest.fn(),
        getCustomFields: jest.fn().mockResolvedValue([]),
        getTeamMembers: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        deleteLead: jest.fn(),
        bulkLeadAction: jest.fn(),
        importLeads: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const baseLead = {
    mobile: '01700000000',
    email: null,
    category: null,
    categoryOption: null,
    source: 'WALK_IN',
    sourceOption: { id: 'src-1', name: 'Walk-in' },
    priority: 'MEDIUM',
    status: 'NEW',
    score: 20,
    photo_url: null,
    next_step: null,
    next_step_date: null,
    last_contacted_at: null,
    nextStepAssignee: null,
    custom_fields: null,
    created_at: '2026-08-01T08:00:00.000Z',
};

const leads = [
    { ...baseLead, id: 'lead-1', name: 'Karim Traders', email: 'karim@example.com', assigned_to: 'user-2', assignee: { id: 'user-2', name: 'Rifat' } },
    { ...baseLead, id: 'lead-2', name: 'Rahim Stores', assigned_to: null, assignee: null },
];

/** The owner filter sits among several unlabelled filter selects. */
function selectByOption(optionText: string): HTMLSelectElement {
    const option = screen.getByRole('option', { name: optionText });
    return option.closest('select') as HTMLSelectElement;
}

describe('LeadsPage — lead owner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
    });

    it('shows a Lead Owner column naming the owner, and a dash when nobody owns it', async () => {
        render(<LeadsPage />);

        expect(await screen.findByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /lead owner/i })).toBeInTheDocument();
        // A cell, not the filter's option of the same name.
        expect(screen.getByRole('cell', { name: 'Rifat' })).toBeInTheDocument();

        const owned = screen.getByRole('cell', { name: 'Karim Traders' }).closest('tr')!;
        const unowned = screen.getByRole('cell', { name: 'Rahim Stores' }).closest('tr')!;
        const ownerColumn = screen.getAllByRole('columnheader').findIndex((h) => /lead owner/i.test(h.textContent ?? ''));
        expect(owned.querySelectorAll('td')[ownerColumn]).toHaveTextContent('Rifat');
        expect(unowned.querySelectorAll('td')[ownerColumn]).toHaveTextContent('—');
    });

    it('filters the list to one owner', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All owners'), { target: { value: 'user-2' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'user-2' })),
        );
    });

    it('filters the list to leads nobody owns', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All owners'), { target: { value: 'unassigned' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'unassigned' })),
        );
    });
});

describe('LeadsPage — email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([]);
    });

    it('shows an Email column with the address, and a dash where there is none', async () => {
        render(<LeadsPage />);

        expect(await screen.findByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument();

        const emailColumn = screen
            .getAllByRole('columnheader')
            .findIndex((h) => /email/i.test(h.textContent ?? ''));
        const withEmail = screen.getByRole('cell', { name: 'Karim Traders' }).closest('tr')!;
        const without = screen.getByRole('cell', { name: 'Rahim Stores' }).closest('tr')!;
        expect(withEmail.querySelectorAll('td')[emailColumn]).toHaveTextContent('karim@example.com');
        expect(without.querySelectorAll('td')[emailColumn]).toHaveTextContent('—');
    });

    it('filters the list to leads with no email', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All emails'), { target: { value: 'empty' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ emailPresence: 'empty' })),
        );
    });

    it('filters the list to leads that have one', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All emails'), { target: { value: 'has' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ emailPresence: 'has' })),
        );
    });

    it('sends no email filter while the control sits at its default', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(api.getLeads).toHaveBeenCalledWith(
            expect.objectContaining({ emailPresence: undefined }),
        );
    });
});
