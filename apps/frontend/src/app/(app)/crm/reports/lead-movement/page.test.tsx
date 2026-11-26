import { render, screen, waitFor } from '@testing-library/react';
import CrmLeadMovementPage from './page';

const getCrmLeadMovement = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmLeadMovement: (...args: unknown[]) => getCrmLeadMovement(...args) },
}));
jest.mock('@/lib/crm-scope', () => ({
    useCrmMineOnly: () => ({ mineOnly: false, setMineOnly: jest.fn(), ready: true }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    usePathname: () => '/crm/reports/lead-movement',
    useSearchParams: () => new URLSearchParams(),
}));

const stage = (
    id: string,
    name: string,
    extra: Record<string, unknown> = {},
) => ({
    id,
    code: name.toUpperCase().replace(/\s+/g, '_'),
    name,
    lifecycle: 'OPEN',
    is_system: false,
    is_active: true,
    sort_order: 1,
    ...extra,
});

const negotiation = stage('neg', 'Negotiation', { sort_order: 4 });
const contacted = stage('con', 'Contacted', { sort_order: 2 });
const converted = stage('won', 'Converted', { lifecycle: 'CONVERTED', is_system: true, sort_order: 5 });
const lost = stage('lost', 'Lost', { lifecycle: 'LOST', is_system: true, sort_order: 6 });

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false, status_ids: ['neg', 'con', 'won', 'lost'] },
    available_stages: [contacted, negotiation, converted, lost],
    stages: [
        { ...negotiation, count: 4, share_pct: 40 },
        { ...contacted, count: 3, share_pct: 30 },
        { ...converted, count: 2, share_pct: 20 },
        { ...lost, count: 1, share_pct: 10 },
    ],
    totals: { moved: 10, converted: 2, lost: 1, conversion_pct: 66.7 },
    ...overrides,
});

beforeEach(() => getCrmLeadMovement.mockReset().mockResolvedValue(report()));

describe('CRM lead movement report', () => {
    it('asks for the window (called after ready)', async () => {
        render(<CrmLeadMovementPage />);

        await waitFor(() => expect(getCrmLeadMovement).toHaveBeenCalled());
        const arg = getCrmLeadMovement.mock.calls[0][0] as Record<string, unknown>;
        expect(arg).toEqual(expect.objectContaining({
            from: expect.any(String),
            to: expect.any(String),
            mine: false,
        }));
        expect(arg.statusIds).toBeUndefined();
    });

    it('draws a row per stage with count and share', async () => {
        render(<CrmLeadMovementPage />);

        const row = await screen.findByRole('row', { name: /Negotiation/ });
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('leads')).toBe('4');
        expect(cell('share_pct')).toBe('40%');
    });

    it('handles a window with no movement', async () => {
        getCrmLeadMovement.mockResolvedValue(report({
            stages: [],
            totals: { moved: 0, converted: 0, lost: 0, conversion_pct: null },
        }));
        render(<CrmLeadMovementPage />);

        expect(await screen.findByText('No leads changed stage in this period.')).toBeInTheDocument();
    });

    it('shows a dash when conversion rate has no base', async () => {
        getCrmLeadMovement.mockResolvedValue(report({
            totals: { moved: 10, converted: 0, lost: 0, conversion_pct: null },
        }));
        render(<CrmLeadMovementPage />);

        await screen.findByRole('row', { name: /Negotiation/ });
        const rate = screen.getByText('Conversion rate').closest('div');
        expect(rate).toHaveTextContent('—');
    });
});
