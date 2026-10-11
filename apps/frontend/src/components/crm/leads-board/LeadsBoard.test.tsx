import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LeadsBoard from './LeadsBoard';
import { buildBoardColumns, type BoardColumnSources, type BoardLead } from './board-columns';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

/**
 * The real context, with its handlers kept so a test can finish a drag the
 * sensors cannot produce in jsdom.
 */
const mockDnd: { onDragEnd?: (event: any) => void } = {};
jest.mock('@dnd-kit/core', () => {
    const actual = jest.requireActual('@dnd-kit/core');
    return {
        ...actual,
        DndContext: (props: any) => {
            mockDnd.onDragEnd = props.onDragEnd;
            return <actual.DndContext {...props} />;
        },
    };
});

jest.mock('@/lib/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(message: string, public readonly status: number) {
            super(message);
            this.name = 'ApiError';
        }
    },
    api: {
        getLeads: jest.fn(),
        updateLead: jest.fn(),
        convertLead: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api, ApiError } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast');

function option(id: string, name: string, lifecycle: string, extra: Record<string, unknown> = {}) {
    return { id, code: id.toUpperCase(), name, lifecycle, sort_order: 0, is_system: false, is_active: true, ...extra } as any;
}

const sources: BoardColumnSources = {
    statuses: [
        option('new', 'New', 'NEW'),
        option('demo', 'Demo booked', 'QUALIFIED'),
        option('won', 'Converted', 'CONVERTED'),
        option('lost', 'Lost', 'LOST'),
    ],
    categories: [],
    sources: [],
    members: [],
    labels: {
        statuses: {},
        priorities: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' },
        unassigned: 'Unassigned',
        uncategorised: 'Uncategorised',
        noSource: 'No source',
    },
};

const columns = buildBoardColumns('status', sources);

function lead(id: string, name: string, extra: Partial<BoardLead> = {}): BoardLead {
    return {
        id,
        name,
        mobile: '01700000000',
        photo_url: null,
        priority: 'MEDIUM',
        status: 'NEW',
        score: 20,
        assignee: null,
        categoryOption: null,
        sourceOption: null,
        ...extra,
    };
}

const karim = lead('lead-1', 'Karim Traders');
const rahim = lead('lead-2', 'Rahim Stores');
const won = lead('lead-3', 'Won Shop', { status: 'CONVERTED' });

/** Leads by stage id; anything else (the filters-only count) answers `matching`. */
function serve(byStage: Record<string, { items: BoardLead[]; total?: number }>, matching?: number) {
    api.getLeads.mockImplementation(async (q: any) => {
        if (!q.statusId) {
            const all = Object.values(byStage).reduce((n, col) => n + (col.total ?? col.items.length), 0);
            return { items: [], total: matching ?? all };
        }
        const col = byStage[q.statusId] ?? { items: [] };
        return { items: col.items, total: col.total ?? col.items.length };
    });
}

function renderBoard() {
    return render(
        <LeadsBoard group="status" columns={columns} baseQuery={{ search: 'kar' }} enabled reloadSignal={0} />,
    );
}

function column(label: string) {
    return screen.getByRole('region', { name: label });
}

function drop(card: BoardLead, from: string, to: string) {
    act(() => {
        mockDnd.onDragEnd?.({ active: { data: { current: { lead: card, from: `status:${from}` } } }, over: { id: `status:${to}` } });
    });
}

describe('LeadsBoard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows a column per stage with its real total, fetched with the list filters and that stage', async () => {
        serve({ new: { items: [karim, rahim], total: 2 }, demo: { items: [] }, won: { items: [won] } });
        renderBoard();

        expect(await within(column('New')).findByText('Karim Traders')).toBeInTheDocument();
        expect(within(column('New')).getByText('2')).toBeInTheDocument();
        expect(await within(column('Demo booked')).findByText('No leads')).toBeInTheDocument();
        expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ search: 'kar', statusId: 'demo', page: 1 }));
    });

    it('fetches the next page of one column on Load more, without repeating a card', async () => {
        serve({ new: { items: [karim], total: 2 } });
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        api.getLeads.mockResolvedValueOnce({ items: [karim, rahim], total: 2 });
        fireEvent.click(within(column('New')).getByRole('button', { name: 'Load more' }));

        expect(await within(column('New')).findByText('Rahim Stores')).toBeInTheDocument();
        expect(within(column('New')).getAllByText('Karim Traders')).toHaveLength(1);
        expect(api.getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ statusId: 'new', page: 2 }));
    });

    it('says how many matching leads sit in no column', async () => {
        serve({ new: { items: [karim] } }, 4);
        renderBoard();

        expect(await screen.findByText(/3 matching leads are not in any column shown/)).toBeInTheDocument();
    });

    it('moves a card to an open stage at once, and saves the stage', async () => {
        serve({ new: { items: [karim] } });
        api.updateLead.mockResolvedValue({ ...karim, status: 'QUALIFIED' });
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        drop(karim, 'new', 'demo');

        expect(within(column('Demo booked')).getByText('Karim Traders')).toBeInTheDocument();
        expect(within(column('New')).queryByText('Karim Traders')).not.toBeInTheDocument();
        await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('lead-1', { status_id: 'demo' }));
    });

    it('puts the card back and says so when the server refuses the move', async () => {
        serve({ new: { items: [karim] } });
        api.updateLead.mockRejectedValue(new Error('Lead status "Demo booked" is hidden.'));
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        drop(karim, 'new', 'demo');

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Karim Traders could not be moved. Lead status "Demo booked" is hidden.'),
        );
        expect(within(column('New')).getByText('Karim Traders')).toBeInTheDocument();
        expect(within(column('Demo booked')).queryByText('Karim Traders')).not.toBeInTheDocument();
    });

    it('asks why before closing a lead as lost, and sends the reason', async () => {
        serve({ new: { items: [karim] } });
        api.updateLead.mockResolvedValue({ ...karim, status: 'LOST' });
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        drop(karim, 'new', 'lost');

        expect(api.updateLead).not.toHaveBeenCalled();
        const confirm = screen.getByRole('button', { name: 'Mark as lost' });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'Lost Reason' }), { target: { value: 'Went with a competitor' } });
        fireEvent.click(confirm);

        await waitFor(() =>
            expect(api.updateLead).toHaveBeenCalledWith('lead-1', { status_id: 'lost', lost_reason: 'Went with a competitor' }),
        );
        expect(await within(column('Lost')).findByText('Karim Traders')).toBeInTheDocument();
    });

    it('leaves the card where it was when the lost dialog is cancelled', async () => {
        serve({ new: { items: [karim] } });
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        drop(karim, 'new', 'lost');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(within(column('New')).getByText('Karim Traders')).toBeInTheDocument();
        expect(api.updateLead).not.toHaveBeenCalled();
    });

    it('converts through the convert endpoint when dropped on the won stage, offering the new customer', async () => {
        serve({ new: { items: [karim] } });
        api.convertLead.mockResolvedValue({ lead: { ...karim, status: 'CONVERTED' }, customer: { id: 'cust-9' } });
        renderBoard();
        await within(column('New')).findByText('Karim Traders');

        drop(karim, 'new', 'won');
        fireEvent.click(screen.getByRole('button', { name: 'Convert to Customer' }));

        await waitFor(() => expect(api.convertLead).toHaveBeenCalledWith('lead-1'));
        expect(api.updateLead).not.toHaveBeenCalled();
        expect(await within(column('Converted')).findByText('Karim Traders')).toBeInTheDocument();
        const [, options] = toast.success.mock.calls[0];
        options.action.onClick();
        expect(push).toHaveBeenCalledWith(expect.stringContaining('cust-9'));
    });

    it('does not let a converted lead be dragged', async () => {
        serve({ won: { items: [won] } });
        renderBoard();

        const card = (await within(column('Converted')).findByText('Won Shop')).closest('[data-testid="lead-card"]')!;
        expect(card).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the plan notice instead of columns when CRM is not on the plan', async () => {
        api.getLeads.mockRejectedValue(new ApiError('Forbidden', 403));
        renderBoard();

        expect(await screen.findByText(/does not include the CRM module/)).toBeInTheDocument();
        expect(screen.queryByTestId('leads-board')).not.toBeInTheDocument();
    });
});
