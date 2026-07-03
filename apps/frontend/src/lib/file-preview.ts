export type FilePreviewKind = 'image' | 'pdf' | 'document' | 'other';

export type VoucherAttachmentItem = {
    id: string;
    url: string;
    fileName: string;
    mimeType?: string;
    fileSize?: number;
};

const DOCUMENT_EXTENSIONS = ['.doc', '.docx', '.docm', '.rtf', '.odt'];
const PDF_EXTENSIONS = ['.pdf'];

export function getFilePreviewKind(mimeType = '', fileName = ''): FilePreviewKind {
    const normalizedMime = mimeType.toLowerCase();
    const normalizedName = fileName.toLowerCase();

    if (normalizedMime.startsWith('image/')) {
        return 'image';
    }

    if (
        normalizedMime === 'application/pdf'
        || PDF_EXTENSIONS.some((extension) => normalizedName.endsWith(extension))
    ) {
        return 'pdf';
    }

    if (
        normalizedMime.includes('word')
        || normalizedMime === 'application/msword'
        || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || DOCUMENT_EXTENSIONS.some((extension) => normalizedName.endsWith(extension))
    ) {
        return 'document';
    }

    return 'other';
}

export function formatFileSize(bytes?: number) {
    if (!bytes || bytes <= 0) {
        return '';
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const VOUCHER_ATTACHMENT_ACCEPT = [
    'image/*',
    '.pdf',
    '.doc',
    '.docx',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

export const VOUCHER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;