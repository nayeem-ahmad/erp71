import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SegmentRulesModal from './SegmentRulesModal';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomerSegmentSettings: jest.fn(),
        updateCustomerSegmentSettings: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const { api } = jest.requireMock('@/lib/api');

describe('SegmentRulesModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getCustomerSegmentSettings.mockResolvedValue({
            vip_spend_bdt: 50000,
            at_risk_days: 30,
            new_account_days: 30,
        });
        api.updateCustomerSegmentSettings.mockResolvedValue({
            vip_spend_bdt: 50000,
            at_risk_days: 45,
            new_account_days: 30,
            updated: 4,
            total: 40,
        });
    });

    it('loads the tenant rules and saves a 45-day at-risk window', async () => {
        const onSaved = jest.fn();
        const onClose = jest.fn();
        render(<SegmentRulesModal open onClose={onClose} onSaved={onSaved} />);

        const atRisk = await screen.findByLabelText(/At-Risk after/);
        await waitFor(() => expect(atRisk).toHaveValue(30));

        fireEvent.change(atRisk, { target: { value: '45' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and re-run' }));

        await waitFor(() => expect(api.updateCustomerSegmentSettings).toHaveBeenCalledWith({
            vip_spend_bdt: 50000,
            at_risk_days: 45,
            new_account_days: 30,
        }));
        expect(toast.success).toHaveBeenCalledWith('Segment rules saved — 4 customer(s) updated.');
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });
});
