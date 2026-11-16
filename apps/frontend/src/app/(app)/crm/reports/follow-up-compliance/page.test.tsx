import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmFollowUpComplianceReportPage from './page';

const getCrmFollowUpCompliance = jest.fn();

// A wide screen, so the period chip sits in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCrmFollowUpCompliance: (...args: unknown[]) => getCrmFollowUpCompliance(...args),
    },
}));

const baseCounts = {
    due: 5, on_time: 3, late: 1, overdue: 1, pending: 0, cancelled: 0, compliance_pct: 60,
};

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false },
    by_assignee: [
        { user_id: 'u1', name: 'Karim Ahmed', ...baseCounts, compliance_pct: 75 },
        { user_id: null, name: null, ...baseCounts, compliance_pct: 60 },
    ],
    by_purpose: [
        { purpose_id: 'p1', name: 'Site visit', ...baseCounts, compliance_pct: 90 },
        { purpose_id: null, name: null, ...baseCounts, compliance_pct: 20 },
    ],
    totals: baseCounts,
    undated_open: 0,
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    getCrmFollowUpCompliance.mockReset().mockResolvedValue(report());
});

describe('CRM follow-up compliance report', () => {
    it('opens grouped by person', async () => {
        render(<CrmFollowUpComplianceReportPage />);

        expect(await screen.findByRole('cell', { name: 'Karim Ahmed' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveValue('person');
    });

    it('switches to purpose without refetching', async () => {
        render(<CrmFollowUpComplianceReportPage />);
        await screen.findByRole('cell', { name: 'Karim Ahmed' });

        fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'purpose' } });

        expect(await screen.findByRole('cell', { name: 'Site visit' })).toBeInTheDocument();
        expect(getCrmFollowUpCompliance).toHaveBeenCalledTimes(1);
    });

    it('labels unassigned work', async () => {
        render(<CrmFollowUpComplianceReportPage />);

        expect(await screen.findByRole('cell', { name: 'Unassigned' })).toBeInTheDocument();
    });

    it('explains undated follow-ups when there are any', async () => {
        getCrmFollowUpCompliance.mockResolvedValue(report({ undated_open: 3 }));
        render(<CrmFollowUpComplianceReportPage />);

        await waitFor(() => expect(getCrmFollowUpCompliance).toHaveBeenCalled());
        expect(await screen.findByText(/3 planned follow-ups have no due date/)).toBeInTheDocument();
    });
});
