'use client';
import { render, screen, fireEvent } from '@testing-library/react';
import UploadRecipients from './upload-recipients';

jest.mock('@/lib/spreadsheet', () => ({
    parseSpreadsheetFile: jest.fn(),
    autoMapHeaders: jest.fn(() => ({})),
}));

describe('UploadRecipients dropzone', () => {
    afterEach(() => jest.clearAllMocks());

    const renderDropzone = () =>
        render(<UploadRecipients rows={[]} issues={[]} onChange={jest.fn()} />);

    // M15: the dropzone was a div with onClick and no role, tabIndex or key
    // handler, and the file input is .hidden — so there was no way in at all
    // from the keyboard.
    it('is a real button, so it is focusable and reachable by keyboard', () => {
        renderDropzone();

        const dropzone = screen.getByRole('button', { name: /Drag & drop or click to browse/ });

        expect(dropzone).toHaveAttribute('type', 'button');
        dropzone.focus();
        expect(dropzone).toHaveFocus();
    });

    it('opens the file picker when activated', () => {
        const { container } = renderDropzone();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const click = jest.spyOn(input, 'click').mockImplementation(() => {});

        fireEvent.click(screen.getByRole('button', { name: /Drag & drop or click to browse/ }));

        expect(click).toHaveBeenCalled();
    });

    it('keeps a touch-sized target', () => {
        renderDropzone();
        expect(screen.getByRole('button', { name: /Drag & drop or click to browse/ })).toHaveClass(
            'min-h-touch',
        );
    });
});
