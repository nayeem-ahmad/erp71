import { api } from '@/lib/api';
import { resolvePrintPaper } from './useSalePrintPrefs';

jest.mock('@/lib/api', () => ({
    api: { getSalesSettings: jest.fn() },
}));

const getSalesSettings = api.getSalesSettings as jest.Mock;

describe('resolvePrintPaper', () => {
    beforeEach(() => {
        localStorage.clear();
        getSalesSettings.mockReset();
    });

    it('takes the paper this browser chose in Print settings', async () => {
        localStorage.setItem('erp71:sales-print:paper-size', 'A5');

        await expect(resolvePrintPaper()).resolves.toBe('A5');
        expect(getSalesSettings).not.toHaveBeenCalled();
    });

    it('falls back to the shop default when this browser chose nothing', async () => {
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Letter' });

        await expect(resolvePrintPaper()).resolves.toBe('Letter');
    });

    it('ignores a stored value that is not a paper size', async () => {
        localStorage.setItem('erp71:sales-print:paper-size', 'Poster');
        getSalesSettings.mockResolvedValue({ default_paper_size: 'Thermal80' });

        await expect(resolvePrintPaper()).resolves.toBe('Thermal80');
    });

    it('prints on A4 when neither is set or the settings cannot be read', async () => {
        getSalesSettings.mockResolvedValueOnce({});
        await expect(resolvePrintPaper()).resolves.toBe('A4');

        getSalesSettings.mockRejectedValueOnce(new Error('offline'));
        await expect(resolvePrintPaper()).resolves.toBe('A4');
    });
});
