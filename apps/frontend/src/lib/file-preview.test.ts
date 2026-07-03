import {
    formatFileSize,
    getFilePreviewKind,
} from './file-preview';

describe('file-preview', () => {
    it('classifies common voucher attachment types', () => {
        expect(getFilePreviewKind('image/jpeg', 'receipt.jpg')).toBe('image');
        expect(getFilePreviewKind('application/pdf', 'invoice.pdf')).toBe('pdf');
        expect(getFilePreviewKind('', 'memo.docx')).toBe('document');
        expect(getFilePreviewKind('application/octet-stream', 'notes.txt')).toBe('other');
    });

    it('formats file sizes for attachment chips', () => {
        expect(formatFileSize(512)).toBe('512 B');
        expect(formatFileSize(2048)).toBe('2.0 KB');
        expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
});