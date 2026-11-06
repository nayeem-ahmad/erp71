import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CostCentersPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        listCostCenters: jest.fn(),
        createCostCenter: jest.fn(),
        getCostCenterPL: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const CENTERS = [
    { id: 'cc-1', code: 'RET', name: 'Retail', is_active: true },
    { id: 'cc-2', code: 'OLD', name: 'Old Branch', is_active: false },
];

const tile = (id: string) =>
    within(screen.getByRole('region', { name: 'Cost centers summary' })).getByText(id).parentElement as HTMLElement;

describe('CostCentersPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.listCostCenters as jest.Mock).mockResolvedValue(CENTERS);
        (api.createCostCenter as jest.Mock).mockResolvedValue({ id: 'cc-3' });
        (api.getCostCenterPL as jest.Mock).mockResolvedValue({
            revenue: { groups: [], total: 1000 },
            expenses: { groups: [], total: 1500 },
            net_profit: -500,
        });
    });

    it('narrows the centers by status and puts the selected P&L in the strip', async () => {
        render(<CostCentersPage />);
        await screen.findByText('Old Branch');
        expect(tile('Cost centers')).toHaveTextContent('2');

        fireEvent.click(
            screen.getAllByRole('button', { name: 'Status' }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Active' }));
        await waitFor(() => expect(screen.queryByText('Old Branch')).not.toBeInTheDocument());
        expect(tile('Cost centers')).toHaveTextContent('1');

        fireEvent.click(screen.getByRole('button', { name: /Retail/ }));
        await waitFor(() =>
            expect(api.getCostCenterPL).toHaveBeenCalledWith(expect.objectContaining({ costCenterId: 'cc-1' })),
        );
        await waitFor(() => expect(tile('Net Loss')).toHaveTextContent('500'));
        expect(tile('Net Loss').querySelector('.text-red-600')).not.toBeNull();
    });

    it('validates the new cost center inline before creating it', async () => {
        render(<CostCentersPage />);
        await screen.findByText('Retail');

        fireEvent.click(screen.getByRole('button', { name: 'New Cost Center' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
        expect(within(dialog).getByText('Enter a code.')).toBeInTheDocument();
        expect(api.createCostCenter).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'WH' } });
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Warehouse' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(api.createCostCenter).toHaveBeenCalledWith({ code: 'WH', name: 'Warehouse' }));
    });
});
