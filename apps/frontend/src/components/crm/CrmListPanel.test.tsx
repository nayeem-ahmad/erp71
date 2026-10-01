import { render, screen, fireEvent, within } from '@testing-library/react';
import CrmListPanel from './CrmListPanel';

jest.mock('@/lib/api', () => ({
    api: {
        getLeadTaxonomy: jest.fn(),
        getLeadTaxonomyUsage: jest.fn(),
        createLeadTaxonomy: jest.fn(),
        updateLeadTaxonomy: jest.fn(),
        deleteLeadTaxonomy: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const stage = (id: string, code: string, name: string, lifecycle: string, over: Record<string, unknown> = {}) => ({
    id, code, name, lifecycle, sort_order: 1, is_system: true, is_active: true, ...over,
});
const STAGES = [
    stage('st-new', 'NEW', 'New', 'NEW'),
    stage('st-con', 'CONTACTED', 'Contacted', 'CONTACTED'),
    stage('st-neg', 'NEGOTIATION', 'Negotiation', 'QUALIFIED', { is_system: false }),
    stage('st-hidden', 'PAUSED', 'Paused', 'QUALIFIED', { is_system: false, is_active: false }),
    stage('st-won', 'CONVERTED', 'Converted', 'CONVERTED'),
    stage('st-lost', 'LOST', 'Lost', 'LOST'),
];

beforeEach(() => {
    jest.clearAllMocks();
    api.getLeadTaxonomy.mockResolvedValue(STAGES);
    api.getLeadTaxonomyUsage.mockResolvedValue({ 'st-neg': 3 });
});

/** The row whose name (the first match — a badge may repeat the word) is `name`. */
const rowOf = async (name: string) =>
    (await screen.findAllByText(name))[0].closest('li') as HTMLElement;

describe('CrmListPanel — statuses', () => {
    it('labels each stage open, won or lost', async () => {
        render(<CrmListPanel kind="statuses" canManage />);

        expect(within(await rowOf('Negotiation')).getByText('Open')).toBeInTheDocument();
        expect(within(await rowOf('Converted')).getByText('Won')).toBeInTheDocument();
        // The stage's own name and its lifecycle badge both read "Lost".
        expect(within(await rowOf('Lost')).getAllByText('Lost')).toHaveLength(2);
    });

    it('lets New, Converted and Lost be renamed but not hidden or deleted', async () => {
        render(<CrmListPanel kind="statuses" canManage />);

        for (const name of ['New', 'Converted', 'Lost']) {
            const row = await rowOf(name);
            expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
            expect(within(row).queryByRole('button', { name: 'Hide from new entries' })).toBeNull();
            expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
        }
        const contacted = await rowOf('Contacted');
        expect(within(contacted).getByRole('button', { name: 'Hide from new entries' })).toBeInTheDocument();
    });

    it('only offers active open stages as the place to move leads to', async () => {
        render(<CrmListPanel kind="statuses" canManage />);

        fireEvent.click(within(await rowOf('Negotiation')).getByRole('button', { name: 'Delete' }));

        const select = await screen.findByRole('combobox');
        const options = within(select).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['Choose a replacement…', 'New', 'Contacted']);
    });
});
