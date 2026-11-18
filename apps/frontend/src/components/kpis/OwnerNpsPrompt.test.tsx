import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OwnerNpsPrompt from './OwnerNpsPrompt';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getOwnerNpsPrompt: jest.fn(), submitOwnerNps: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

describe('OwnerNpsPrompt', () => {
    beforeEach(() => {
        (api.getOwnerNpsPrompt as jest.Mock).mockReset();
        (api.submitOwnerNps as jest.Mock).mockReset().mockResolvedValue({ ok: true });
    });

    it('stays hidden unless the API says to ask', async () => {
        (api.getOwnerNpsPrompt as jest.Mock).mockResolvedValue({ ask: false });
        render(<OwnerNpsPrompt />);
        await waitFor(() => expect(api.getOwnerNpsPrompt).toHaveBeenCalled());
        expect(screen.queryByTestId('owner-nps-prompt')).not.toBeInTheDocument();
    });

    it('sends the score and comment, then goes away', async () => {
        (api.getOwnerNpsPrompt as jest.Mock).mockResolvedValue({ ask: true });
        render(<OwnerNpsPrompt />);

        expect(await screen.findByText('How likely are you to recommend ERP71 to another business?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        fireEvent.click(screen.getByRole('radio', { name: 'Score 10 of 10' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saves me hours' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(api.submitOwnerNps).toHaveBeenCalledWith({ score: 10, comment: 'Saves me hours' }));
        await waitFor(() => expect(screen.queryByTestId('owner-nps-prompt')).not.toBeInTheDocument());
    });

    it('records "Not now" so the owner is not asked again straight away', async () => {
        (api.getOwnerNpsPrompt as jest.Mock).mockResolvedValue({ ask: true });
        render(<OwnerNpsPrompt />);
        fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
        await waitFor(() => expect(api.submitOwnerNps).toHaveBeenCalledWith({ dismissed: true }));
    });
});
