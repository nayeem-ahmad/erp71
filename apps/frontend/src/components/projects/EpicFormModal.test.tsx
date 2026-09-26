import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EpicFormModal, type Epic } from './EpicFormModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        createProjectEpic: jest.fn(),
        updateProjectEpic: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const epic: Epic = {
    id: 'e1',
    reference: 1,
    code: 'OTB-E1',
    title: 'Online payments',
    status: 'OPEN',
    priority: 'HIGH',
    color: 'PURPLE',
    project_id: 'p1',
};

beforeEach(() => jest.clearAllMocks());

describe('EpicFormModal', () => {
    it('saves an edited epic', async () => {
        (api.updateProjectEpic as jest.Mock).mockResolvedValue({});
        const onSaved = jest.fn();
        render(<EpicFormModal projectId="p1" projectCode="OTB" epic={epic} onClose={jest.fn()} onSaved={onSaved} />);
        fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Payments' } });
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(api.updateProjectEpic).toHaveBeenCalledWith(
            'e1',
            expect.objectContaining({ title: 'Payments', status: 'IN_PROGRESS', color: 'PURPLE' }),
        );
    });

    it('refuses an epic without a title, inline', async () => {
        render(<EpicFormModal projectId="p1" projectCode="OTB" epic={null} onClose={jest.fn()} onSaved={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Give the epic a title.')).toBeInTheDocument();
        expect(api.createProjectEpic).not.toHaveBeenCalled();
    });
});
