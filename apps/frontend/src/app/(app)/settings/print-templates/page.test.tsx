import { render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import PrintTemplatesPage from './page';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getPrintTemplates: jest.fn(),
        createPrintTemplate: jest.fn(),
        updatePrintTemplate: jest.fn(),
        deletePrintTemplate: jest.fn(),
        uploadFile: jest.fn(),
        getStores: jest.fn(),
        getPrintTemplateAssignments: jest.fn(),
        upsertPrintTemplateAssignment: jest.fn(),
    },
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({
        logoUrl: null,
        faviconUrl: null,
        businessName: 'Rahim Traders',
        primaryColor: '#2563eb',
    }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockApi = api as jest.Mocked<typeof api>;

const storedTemplate = {
    id: 'tpl1',
    name: 'Letterhead',
    is_default: true,
    doc_types: ['SALES_INVOICE'],
    config: { layout: 'logo-above', company: { fontSizePt: 18 } },
};

describe('PrintTemplatesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (mockApi.getPrintTemplates as jest.Mock).mockResolvedValue([storedTemplate]);
        (mockApi.getStores as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Main' }]);
        (mockApi.getPrintTemplateAssignments as jest.Mock).mockResolvedValue([]);
    });

    it('lists saved templates and marks the default', async () => {
        render(<PrintTemplatesPage />);

        expect(await screen.findByText('Letterhead')).toBeInTheDocument();
        expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('explains the branding fallback when nothing is saved', async () => {
        (mockApi.getPrintTemplates as jest.Mock).mockResolvedValue([]);

        render(<PrintTemplatesPage />);

        expect(await screen.findByText(/Prints use your branding logo/)).toBeInTheDocument();
    });

    it('loads the selected template into the editor', async () => {
        render(<PrintTemplatesPage />);

        const nameInput = await screen.findByDisplayValue('Letterhead');
        expect(nameInput).toBeInTheDocument();
        // Stored partial config is merged over the defaults.
        expect(screen.getByDisplayValue('18')).toBeInTheDocument();
    });

    it('saves edits to the selected template', async () => {
        (mockApi.updatePrintTemplate as jest.Mock).mockResolvedValue(storedTemplate);

        render(<PrintTemplatesPage />);
        const nameInput = await screen.findByDisplayValue('Letterhead');

        fireEvent.change(nameInput, { target: { value: 'Invoice header' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

        await waitFor(() => expect(mockApi.updatePrintTemplate).toHaveBeenCalled());
        const [id, payload] = (mockApi.updatePrintTemplate as jest.Mock).mock.calls[0];
        expect(id).toBe('tpl1');
        expect(payload.name).toBe('Invoice header');
        expect(payload.is_default).toBe(true);
        expect(payload.doc_types).toEqual(['SALES_INVOICE']);
    });

    it('creates a template when the editor was reset', async () => {
        (mockApi.createPrintTemplate as jest.Mock).mockResolvedValue({ id: 'tpl2' });

        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        fireEvent.click(screen.getByRole('button', { name: /New Template/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

        await waitFor(() => expect(mockApi.createPrintTemplate).toHaveBeenCalled());
        expect(mockApi.updatePrintTemplate).not.toHaveBeenCalled();
    });

    it('adds and removes header lines', async () => {
        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        const before = screen.getAllByLabelText('Text').length;
        fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
        expect(screen.getAllByLabelText('Text')).toHaveLength(before + 1);

        fireEvent.click(screen.getAllByRole('button', { name: 'Remove line' })[0]);
        expect(screen.getAllByLabelText('Text')).toHaveLength(before);
    });

    it('uploads a logo and stores the returned url', async () => {
        (mockApi.uploadFile as jest.Mock).mockResolvedValue({ url: 'https://cdn.example.com/new.png' });

        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() =>
            expect(screen.getByDisplayValue('https://cdn.example.com/new.png')).toBeInTheDocument(),
        );
    });

    it('deletes the selected template after confirmation', async () => {
        (mockApi.deletePrintTemplate as jest.Mock).mockResolvedValue({ success: true });

        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
        const confirm = await screen.findByText('Delete this template?');
        expect(confirm).toBeInTheDocument();

        const dialogButtons = screen.getAllByRole('button', { name: /Delete/ });
        fireEvent.click(dialogButtons[dialogButtons.length - 1]);

        await waitFor(() => expect(mockApi.deletePrintTemplate).toHaveBeenCalledWith('tpl1'));
    });
    it('hides the footer editor until the footer is switched on', async () => {
        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        expect(screen.queryByText('Footer text')).not.toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Print a footer on documents'));

        expect(screen.getByText('Footer text')).toBeInTheDocument();
        expect(screen.getByText('Footer images')).toBeInTheDocument();
    });

    it('saves a designed footer with the template', async () => {
        (mockApi.updatePrintTemplate as jest.Mock).mockResolvedValue(storedTemplate);

        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        fireEvent.click(screen.getByLabelText('Print a footer on documents'));
        fireEvent.click(screen.getByLabelText('Repeat the footer at the bottom of every page'));
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

        await waitFor(() => expect(mockApi.updatePrintTemplate).toHaveBeenCalled());
        const [, payload] = (mockApi.updatePrintTemplate as jest.Mock).mock.calls[0];
        expect(payload.config.footer.show).toBe(true);
        expect(payload.config.footer.repeatOnEveryPage).toBe(true);
    });

    it('adds a header image and stores the uploaded url against it', async () => {
        (mockApi.uploadFile as jest.Mock).mockResolvedValue({ url: 'https://cdn.example.com/seal.png' });

        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        fireEvent.click(screen.getAllByRole('button', { name: 'Add image' })[0]);
        const urlInput = screen.getByLabelText('Image URL');
        expect(urlInput).toBeInTheDocument();

        // The second file input on the page belongs to the new image row; the
        // first is the logo slot.
        const inputs = document.querySelectorAll('input[type="file"]');
        const file = new File(['x'], 'seal.png', { type: 'image/png' });
        fireEvent.change(inputs[inputs.length - 1], { target: { files: [file] } });

        await waitFor(() =>
            expect(screen.getByDisplayValue('https://cdn.example.com/seal.png')).toBeInTheDocument(),
        );
    });

    it('previews the letterhead inside the page margin, so lines wrap as they print', async () => {
        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');
        const preview = screen.getByTitle('Print header preview').getAttribute('srcdoc') ?? '';

        expect(preview).toContain('<div class="p71-pv-sheet"><div class="p71-wrap">');
        expect(preview).toContain('padding: 15mm');
    });

    describe('a separate design per paper', () => {
        const choosePaper = (paper: string) =>
            fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: paper } });
        const panel = (paper: string) => within(screen.getByRole('group', { name: `${paper} design` }));
        const nameOverride = () =>
            screen.getByPlaceholderText('Leave blank to use your branding name') as HTMLInputElement;
        const preview = () => screen.getByTitle('Print header preview').getAttribute('srcdoc') ?? '';
        const savedConfig = async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
            await waitFor(() => expect(mockApi.updatePrintTemplate).toHaveBeenCalled());
            return (mockApi.updatePrintTemplate as jest.Mock).mock.calls[0][1].config;
        };
        const withA5Design = {
            ...storedTemplate,
            config: { ...storedTemplate.config, paperDesigns: { A5: { company: { nameOverride: 'A5 Traders' } } } },
        };

        beforeEach(() => {
            (mockApi.updatePrintTemplate as jest.Mock).mockResolvedValue(storedTemplate);
        });

        it('offers nothing to design separately on A4, the main design', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            expect(screen.queryByRole('button', { name: /separately/ })).not.toBeInTheDocument();
        });

        it('edits the A4 design while A5 still prints it', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            choosePaper('A5');
            expect(panel('A5').getByText(/A5 prints the A4 design/)).toBeInTheDocument();
            fireEvent.change(nameOverride(), { target: { value: 'Shared Traders' } });

            const config = await savedConfig();
            expect(config.company.nameOverride).toBe('Shared Traders');
            expect(config.paperDesigns).toBeUndefined();
        });

        it('designs A5 separately, starting from a copy of the A4 design', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            choosePaper('A5');
            fireEvent.click(panel('A5').getByRole('button', { name: 'Design A5 separately' }));
            expect(screen.getByText('Editing the A5 design. The A4 design is not changed.')).toBeInTheDocument();

            fireEvent.change(nameOverride(), { target: { value: 'A5 Traders' } });
            expect(preview()).toContain('A5 Traders');

            choosePaper('A4');
            expect(nameOverride().value).toBe('');
            expect(preview()).not.toContain('A5 Traders');

            const config = await savedConfig();
            expect(config.company.nameOverride).toBeUndefined();
            expect(config.paperDesigns.A5.company).toMatchObject({ nameOverride: 'A5 Traders', fontSizePt: 18 });
        });

        describe('on a template whose A5 is designed separately', () => {
            beforeEach(() => {
                (mockApi.getPrintTemplates as jest.Mock).mockResolvedValue([withA5Design]);
            });

            it('says so on A4, where the A5 design does not show', async () => {
                render(<PrintTemplatesPage />);
                await screen.findByDisplayValue('Letterhead');

                expect(screen.getByText('A5 designed separately — pick it in the preview to edit it.')).toBeInTheDocument();
                expect(nameOverride().value).toBe('');
            });

            it('loads the A5 design into the editor on A5', async () => {
                render(<PrintTemplatesPage />);
                await screen.findByDisplayValue('Letterhead');

                choosePaper('A5');

                expect(nameOverride().value).toBe('A5 Traders');
                expect(panel('A5').getByText(/A5 has its own design/)).toBeInTheDocument();
            });

            it('puts A5 back on the A4 design once confirmed', async () => {
                render(<PrintTemplatesPage />);
                await screen.findByDisplayValue('Letterhead');

                choosePaper('A5');
                fireEvent.click(panel('A5').getByRole('button', { name: 'Use the A4 design on A5' }));
                expect(await screen.findByText('Go back to the A4 design on A5?')).toBeInTheDocument();
                fireEvent.click(screen.getByRole('button', { name: 'Use the A4 design' }));

                expect(nameOverride().value).toBe('');
                expect((await savedConfig()).paperDesigns).toBeUndefined();
            });
        });
    });

    describe('a separate design per thermal roll', () => {
        const choosePaper = (paper: string) =>
            fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: paper } });
        const panel = (paper: string) => within(screen.getByRole('group', { name: `${paper} design` }));
        const nameOverride = () =>
            screen.getByPlaceholderText('Leave blank to use your branding name') as HTMLInputElement;
        const savedConfig = async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
            await waitFor(() => expect(mockApi.updatePrintTemplate).toHaveBeenCalled());
            return (mockApi.updatePrintTemplate as jest.Mock).mock.calls[0][1].config;
        };

        beforeEach(() => {
            (mockApi.updatePrintTemplate as jest.Mock).mockResolvedValue(storedTemplate);
        });

        it('designs 80mm separately, without the controls a roll cannot use', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');
            fireEvent.click(screen.getByLabelText('Print a footer on documents'));

            choosePaper('Thermal80');
            expect(panel('80mm Thermal').getByText(/shrunk to fit the roll/)).toBeInTheDocument();
            expect(screen.getByLabelText('Show the logo on thermal receipts')).toBeInTheDocument();
            expect(panel('80mm Thermal').queryByRole('button', { name: /Copy the/ })).not.toBeInTheDocument();

            fireEvent.click(panel('80mm Thermal').getByRole('button', { name: 'Design 80mm Thermal separately' }));
            expect(panel('80mm Thermal').getByText(/without the automatic shrinking/)).toBeInTheDocument();
            expect(screen.queryByLabelText('Show the logo on thermal receipts')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Repeat the footer at the bottom of every page')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Push the footer to the bottom edge of the page')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Let the footer run to the paper edge')).not.toBeInTheDocument();

            fireEvent.change(nameOverride(), { target: { value: 'Roll Traders' } });
            const config = await savedConfig();
            expect(config.company.nameOverride).toBeUndefined();
            expect(config.paperDesigns.Thermal80.company.nameOverride).toBe('Roll Traders');
        });

        it('starts 58mm from a copy of the 80mm design', async () => {
            (mockApi.getPrintTemplates as jest.Mock).mockResolvedValue([{
                ...storedTemplate,
                config: { ...storedTemplate.config, paperDesigns: { Thermal80: { company: { nameOverride: 'Roll Traders' } } } },
            }]);
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            choosePaper('Thermal58');
            fireEvent.click(panel('58mm Thermal').getByRole('button', { name: 'Copy the 80mm Thermal design' }));
            expect(nameOverride().value).toBe('Roll Traders');

            const config = await savedConfig();
            expect(config.paperDesigns.Thermal58.company.nameOverride).toBe('Roll Traders');
            expect(config.paperDesigns.Thermal80.company.nameOverride).toBe('Roll Traders');
        });
    });

    describe('the QR code', () => {
        const preview = () => screen.getByTitle('Print header preview').getAttribute('srcdoc') ?? '';

        it('saves where the code sits and how large it prints', async () => {
            (mockApi.updatePrintTemplate as jest.Mock).mockResolvedValue(storedTemplate);

            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            fireEvent.change(screen.getByLabelText('QR code position'), { target: { value: 'right-of-title' } });
            fireEvent.change(screen.getByLabelText('QR code size (mm)'), { target: { value: '28' } });
            fireEvent.change(screen.getByLabelText('Nudge QR down (mm)'), { target: { value: '3' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

            await waitFor(() => expect(mockApi.updatePrintTemplate).toHaveBeenCalled());
            const [, payload] = (mockApi.updatePrintTemplate as jest.Mock).mock.calls[0];
            expect(payload.config.version).toBe(5);
            expect(payload.config.qr).toEqual({ sizeMm: 28, position: 'right-of-title', offsetXMm: 0, offsetYMm: 3 });
        });

        it('previews a sample code at the chosen size, in place of the number and date', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            fireEvent.change(screen.getByLabelText('QR code size (mm)'), { target: { value: '28' } });

            expect(preview()).toContain('<img class="p71-hd-qr" src="data:image/svg+xml,');
            expect(preview()).toContain('width: 28mm; height: 28mm;');
            expect(preview()).not.toContain('INV-000123');
        });

        it('previews the header documents without a code print, on request', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            fireEvent.click(screen.getByLabelText('Show the QR code'));

            expect(preview()).not.toContain('<img class="p71-hd-qr"');
            expect(preview()).toContain('INV-000123');
        });

        it('leaves the code off a roll, as no roll prints one', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');

            fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: 'Thermal80' } });

            expect(preview()).not.toContain('<img class="p71-hd-qr"');
        });

        it('lets a size be typed past the minimum, applying it on leaving the field', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');
            const size = screen.getByLabelText('QR code size (mm)') as HTMLInputElement;

            // The "2" of "25" must survive the keystroke, not jump to the minimum.
            fireEvent.change(size, { target: { value: '2' } });
            expect(size.value).toBe('2');

            fireEvent.focusOut(size);
            expect(size.value).toBe('10');
        });
    });

    it('removes a header image', async () => {
        render(<PrintTemplatesPage />);
        await screen.findByDisplayValue('Letterhead');

        fireEvent.click(screen.getAllByRole('button', { name: 'Add image' })[0]);
        expect(screen.getAllByLabelText('Image URL')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
        expect(screen.queryByLabelText('Image URL')).not.toBeInTheDocument();
    });
    describe('what each branch prints', () => {
        const twoStores = [
            { id: 's1', name: 'Gulshan' },
            { id: 's2', name: 'Dhanmondi' },
        ];
        const invoiceSelect = () =>
            screen.getByRole('combobox', { name: 'Sales invoices' }) as HTMLSelectElement;

        it('hides branch assignment when the tenant has one store', async () => {
            render(<PrintTemplatesPage />);
            await screen.findByDisplayValue('Letterhead');
            expect(screen.queryByText('What each branch prints')).not.toBeInTheDocument();
        });

        it('shows branch assignment when the tenant has two stores', async () => {
            (mockApi.getStores as jest.Mock).mockResolvedValue(twoStores);
            render(<PrintTemplatesPage />);
            expect(await screen.findByText('What each branch prints')).toBeInTheDocument();
            // Company is selected first and only explains where company paper lives.
            expect(screen.queryByRole('combobox', { name: 'Sales invoices' })).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
            expect(invoiceSelect().value).toBe('');
            expect(invoiceSelect()).toHaveTextContent('Company default');
        });

        it('selects a branch\u2019s existing pin', async () => {
            (mockApi.getStores as jest.Mock).mockResolvedValue(twoStores);
            (mockApi.getPrintTemplateAssignments as jest.Mock).mockResolvedValue([
                { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
            ]);
            render(<PrintTemplatesPage />);
            await screen.findByText('What each branch prints');

            fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
            expect(invoiceSelect().value).toBe('tpl1');

            fireEvent.click(screen.getByRole('button', { name: 'Dhanmondi' }));
            expect(invoiceSelect().value).toBe('');
        });

        it('PUTs a named template for the selected branch and type', async () => {
            (mockApi.getStores as jest.Mock).mockResolvedValue(twoStores);
            (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockResolvedValue({ success: true });
            render(<PrintTemplatesPage />);
            await screen.findByText('What each branch prints');

            fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
            fireEvent.change(invoiceSelect(), { target: { value: 'tpl1' } });

            await waitFor(() =>
                expect(mockApi.upsertPrintTemplateAssignment).toHaveBeenCalledWith({
                    storeId: 's1',
                    docType: 'SALES_INVOICE',
                    templateId: 'tpl1',
                }),
            );
            expect(invoiceSelect().value).toBe('tpl1');
            expect(mockApi.updatePrintTemplate).not.toHaveBeenCalled();
        });

        it('PUTs templateId null for Company default', async () => {
            (mockApi.getStores as jest.Mock).mockResolvedValue(twoStores);
            (mockApi.getPrintTemplateAssignments as jest.Mock).mockResolvedValue([
                { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
            ]);
            (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockResolvedValue({ success: true });
            render(<PrintTemplatesPage />);
            await screen.findByText('What each branch prints');

            fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
            fireEvent.change(invoiceSelect(), { target: { value: '' } });

            await waitFor(() =>
                expect(mockApi.upsertPrintTemplateAssignment).toHaveBeenCalledWith({
                    storeId: 's1',
                    docType: 'SALES_INVOICE',
                    templateId: null,
                }),
            );
        });

        it('reverts the select and says so when the PUT fails', async () => {
            (mockApi.getStores as jest.Mock).mockResolvedValue(twoStores);
            (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockRejectedValue(new Error('nope'));
            render(<PrintTemplatesPage />);
            await screen.findByText('What each branch prints');

            fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
            fireEvent.change(invoiceSelect(), { target: { value: 'tpl1' } });

            await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save the branch letterhead.'));
            expect(invoiceSelect().value).toBe('');
        });
    });
});
