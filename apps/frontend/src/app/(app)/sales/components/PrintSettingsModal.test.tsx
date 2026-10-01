import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
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

describe('PrintSettingsModal — invoice layout', () => {
    const member = {
        ...DEFAULT_INVOICE_PRINT_PREFS,
        table_style: 'striped' as const,
        serial_column: true,
    };

    function renderWithLayout(save = jest.fn().mockResolvedValue(member)) {
        const onSave = jest.fn();
        const onClose = jest.fn();
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                onSave={onSave}
                onClose={onClose}
                invoiceLayout={{ prefs: member, save }}
            />,
        );
        return { onSave, onClose, save };
    }

    it('is left out where the screen prints no sales invoices', () => {
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                onSave={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(screen.queryByText('Invoice layout')).not.toBeInTheDocument();
    });

    it("opens on the member's saved layout", () => {
        renderWithLayout();
        expect(screen.getByLabelText('Item table style')).toHaveValue('striped');
        expect(screen.getByLabelText(/Serial number \(SL\) column/)).toBeChecked();
        expect(screen.getByLabelText(/Total in words/)).not.toBeChecked();
    });

    it('saves only what changed to the account, then the device settings', async () => {
        const { save, onSave, onClose } = renderWithLayout();

        fireEvent.change(screen.getByLabelText('Space around the content'), { target: { value: 'wide' } });
        fireEvent.change(screen.getByLabelText('Previous due and total due'), { target: { value: 'never' } });
        fireEvent.click(screen.getByLabelText(/Total in words/));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith({ padding: 'wide', balance: 'never', amount_in_words: true });
        expect(onSave).toHaveBeenCalledWith({ paperSize: 'A4', skipPreview: false, density: 'normal' });
    });

    it('does not call the server when the layout is unchanged', async () => {
        const { save, onClose } = renderWithLayout();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(save).not.toHaveBeenCalled();
    });

    it('takes custom footer text, and an empty string for no footer', async () => {
        const { save, onClose } = renderWithLayout();

        fireEvent.change(screen.getByLabelText('Footer'), { target: { value: 'custom' } });
        fireEvent.change(screen.getByPlaceholderText(/Goods once sold/), {
            target: { value: 'No returns after 7 days' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(save).toHaveBeenLastCalledWith({ footer_text: 'No returns after 7 days' });
    });

    it('saves "no footer" as an empty footer text', async () => {
        const { save, onClose } = renderWithLayout();

        fireEvent.change(screen.getByLabelText('Footer'), { target: { value: 'none' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith({ footer_text: '' });
    });

    it('stays open with an error when the account save fails, saving nothing on the device', async () => {
        const { onSave, onClose } = renderWithLayout(jest.fn().mockRejectedValue(new Error('network')));

        fireEvent.click(screen.getByLabelText(/Total in words/));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your invoice layout');
        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
