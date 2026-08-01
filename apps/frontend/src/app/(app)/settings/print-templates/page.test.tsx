import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import PrintTemplatesPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getPrintTemplates: jest.fn(),
        createPrintTemplate: jest.fn(),
        updatePrintTemplate: jest.fn(),
        deletePrintTemplate: jest.fn(),
        uploadFile: jest.fn(),
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
});
