import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectCostingSettingsCard from './ProjectCostingSettingsCard';

jest.mock('@/lib/api', () => ({
    api: { getProjectCostingSettings: jest.fn(), updateProjectCostingSettings: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getProjectCostingSettings: jest.Mock; updateProjectCostingSettings: jest.Mock };
};

describe('ProjectCostingSettingsCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectCostingSettings.mockResolvedValue({ standardMonthlyHours: 208, overheadPct: 0 });
        api.updateProjectCostingSettings.mockImplementation(async (data: unknown) => data);
    });

    it('saves the hours and overhead', async () => {
        render(<ProjectCostingSettingsCard canEdit />);

        fireEvent.change(await screen.findByLabelText('Standard working hours per month'), { target: { value: '176' } });
        fireEvent.change(screen.getByLabelText('Overhead on salary (%)'), { target: { value: '15' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.updateProjectCostingSettings).toHaveBeenCalledWith({ standardMonthlyHours: 176, overheadPct: 15 }),
        );
    });

    it('is read-only without the right to change project settings', async () => {
        render(<ProjectCostingSettingsCard canEdit={false} />);

        expect(await screen.findByLabelText('Standard working hours per month')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });

    it('will not save hours a month cannot hold', async () => {
        render(<ProjectCostingSettingsCard canEdit />);

        fireEvent.change(await screen.findByLabelText('Standard working hours per month'), { target: { value: '0' } });

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
});
