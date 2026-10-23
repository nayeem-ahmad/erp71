import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse, type PreferenceSource } from '@erp71/shared-types';
import { reloadInvoicePrintPrefs } from '@/lib/hooks/useInvoicePrintPrefs';
import { usePreferencesStore } from '@/lib/preferences/store';
import PrintSettingsModal from './PrintSettingsModal';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({ api: {} }));
jest.mock('@/lib/hooks/useInvoicePrintPrefs', () => ({
    reloadInvoicePrintPrefs: jest.fn(),
}));


describe('PrintSettingsModal — compact', () => {
    it('saves the compact choice along with the other two settings', () => {
        const onSave = jest.fn();
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                typeScale="normal"
                onSave={onSave}
                onClose={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByLabelText(/Compact layout/));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ paperSize: 'A4', skipPreview: false, density: 'compact', typeScale: 'normal' });
    });

    it('saves a larger text size for this browser', () => {
        const onSave = jest.fn();
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                typeScale="normal"
                onSave={onSave}
                onClose={jest.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('Text size'), { target: { value: 'large' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ paperSize: 'A4', skipPreview: false, density: 'normal', typeScale: 'large' });
    });

    it('opens on the answer the counter already has', () => {
        render(
            <PrintSettingsModal
                paperSize="A5"
                skipPreview
                density="compact"
                typeScale="normal"
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
                typeScale="normal"
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
                typeScale="normal"
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
                typeScale="normal"
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
        expect(onSave).toHaveBeenCalledWith({ paperSize: 'A4', skipPreview: false, density: 'normal', typeScale: 'normal' });
    });

    it('saves the detailed design\u2019s table borders', async () => {
        const { save, onClose } = renderWithLayout();
        expect(screen.getByLabelText('Table borders (detailed design)')).toHaveValue('none');

        fireEvent.change(screen.getByLabelText('Table borders (detailed design)'), { target: { value: 'columns' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith({ table_borders: 'columns' });
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

    describe('space above the signatures', () => {
        const space = () => screen.queryByLabelText('Space above signatures (mm)');

        it('appears once signature lines are on, and saves the gap with them', async () => {
            const { save, onClose } = renderWithLayout();
            expect(space()).not.toBeInTheDocument();

            fireEvent.click(screen.getByLabelText(/signature lines/));
            expect(space()).toHaveValue(null);
            expect(space()).toHaveAttribute('placeholder', 'Default (13)');
            fireEvent.change(space()!, { target: { value: '25' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(save).toHaveBeenCalledWith({ signature_lines: true, signature_space_mm: 25 });
        });

        it('goes back to the default gap when cleared', async () => {
            const save = jest.fn().mockResolvedValue(member);
            const onClose = jest.fn();
            render(
                <PrintSettingsModal
                    paperSize="A4"
                    skipPreview={false}
                    density="normal"
                    typeScale="normal"
                    onSave={jest.fn()}
                    onClose={onClose}
                    invoiceLayout={{ prefs: { ...member, signature_lines: true, signature_space_mm: 30 }, save }}
                />,
            );
            expect(space()).toHaveValue(30);

            fireEvent.change(space()!, { target: { value: '' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(save).toHaveBeenCalledWith({ signature_space_mm: null });
        });

        it('says what it takes, and holds Save, when the gap is out of range', async () => {
            const { save, onClose } = renderWithLayout();
            fireEvent.click(screen.getByLabelText(/signature lines/));

            fireEvent.change(space()!, { target: { value: '60' } });
            expect(screen.getByText('Enter a whole number from 5 to 40.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

            fireEvent.change(space()!, { target: { value: '12' } });
            expect(screen.queryByText('Enter a whole number from 5 to 40.')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));
            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(save).toHaveBeenCalledWith({ signature_lines: true, signature_space_mm: 12 });
        });

        it('lets Save through again when the signature lines are turned back off', () => {
            renderWithLayout();
            fireEvent.click(screen.getByLabelText(/signature lines/));
            fireEvent.change(space()!, { target: { value: '60' } });
            expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

            fireEvent.click(screen.getByLabelText(/signature lines/));

            expect(space()).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        });
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

describe('PrintSettingsModal — where the invoice layout comes from', () => {
    const member = { ...DEFAULT_INVOICE_PRINT_PREFS, table_style: 'striped' as const };

    function hydrate(source: PreferenceSource) {
        const data: MyPreferencesResponse = {
            profile: { id: 'p1', name: 'Cashier setup' },
            legacy_browser_sections: [],
            sections: {
                invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source },
                tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                tableColumns: { value: DEFAULT_SECTION_VALUES.tableColumns, source: 'default' },
                sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                device: { value: {}, source: 'default' },
            },
        };
        usePreferencesStore.getState().hydrate('t:u', data);
    }

    function open() {
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                typeScale="normal"
                onSave={jest.fn()}
                onClose={jest.fn()}
                invoiceLayout={{ prefs: member, save: jest.fn() }}
            />,
        );
    }

    beforeEach(() => {
        signInForPreferences('t:u');
        usePreferencesStore.getState().clear();
        (reloadInvoicePrintPrefs as jest.Mock).mockReset();
        (reloadInvoicePrintPrefs as jest.Mock).mockResolvedValue(DEFAULT_INVOICE_PRINT_PREFS);
    });

    it('PrintSettingsModal shows the same line for invoicePrint', () => {
        hydrate('profile');
        open();
        expect(screen.getByText('Following Cashier setup default')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });

    it('resets a customised layout and shows the layout that results', async () => {
        hydrate('member');
        const reset = jest.fn().mockResolvedValue(undefined);
        usePreferencesStore.setState({ reset });
        open();
        expect(screen.getByLabelText('Item table style')).toHaveValue('striped');

        expect(screen.getByText('Customised')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        await waitFor(() => expect(reset).toHaveBeenCalledWith('invoicePrint'));
        await waitFor(() => expect(reloadInvoicePrintPrefs).toHaveBeenCalled());
        await waitFor(() =>
            expect(screen.getByLabelText('Item table style')).toHaveValue(DEFAULT_INVOICE_PRINT_PREFS.table_style),
        );
    });

    it('clears a custom footer and signature gap from the fields when reset', async () => {
        hydrate('member');
        usePreferencesStore.setState({ reset: jest.fn().mockResolvedValue(undefined) });
        const custom = {
            ...DEFAULT_INVOICE_PRINT_PREFS,
            footer_text: 'No returns after 7 days',
            signature_lines: true,
            signature_space_mm: 25,
        };
        render(
            <PrintSettingsModal
                paperSize="A4"
                skipPreview={false}
                density="normal"
                typeScale="normal"
                onSave={jest.fn()}
                onClose={jest.fn()}
                invoiceLayout={{ prefs: custom, save: jest.fn() }}
            />,
        );
        expect(screen.getByLabelText('Footer')).toHaveValue('custom');
        expect(screen.getByLabelText('Space above signatures (mm)')).toHaveValue(25);

        // Leave the gap out of range, so Save is blocked until the fields are reset.
        fireEvent.change(screen.getByLabelText('Space above signatures (mm)'), { target: { value: '9999' } });
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        await waitFor(() => expect(screen.getByLabelText('Footer')).toHaveValue('default'));
        expect(screen.queryByPlaceholderText(/Goods once sold/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Space above signatures (mm)')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

        // The gap is back to the default too, not just hidden.
        fireEvent.click(screen.getByLabelText(/signature lines/));
        expect(screen.getByLabelText('Space above signatures (mm)')).toHaveValue(null);
    });

    it('shows no line when preferences are not loaded', () => {
        open();
        expect(screen.queryByText(/Using the built-in setting|Customised/)).not.toBeInTheDocument();
    });
});
