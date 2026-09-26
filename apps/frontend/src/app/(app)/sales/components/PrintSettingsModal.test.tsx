import { fireEvent, render, screen } from '@testing-library/react';
import PrintSettingsModal from './PrintSettingsModal';

describe('PrintSettingsModal — compact', () => {
    it('saves the compact choice along with the other two settings', () => {
        const onSave = jest.fn();
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                onSave={onSave}
                onClose={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByLabelText(/Compact layout/));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ paperSize: 'A4', skipPreview: false, density: 'compact' });
    });

    it('opens on the answer the counter already has', () => {
        render(
            <PrintSettingsModal
                paperSize="A5"
                skipPreview
                density="compact"
                onSave={jest.fn()}
                onClose={jest.fn()}
            />,
        );

        expect(screen.getByLabelText(/Compact layout/)).toBeChecked();
    });

    it('changes nothing when backed out of', () => {
        const onSave = jest.fn();
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                onSave={onSave}
                onClose={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByLabelText(/Compact layout/));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onSave).not.toHaveBeenCalled();
    });
});
