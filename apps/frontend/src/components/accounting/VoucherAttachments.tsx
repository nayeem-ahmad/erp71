'use client';

import { useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import {
    formatFileSize,
    getFilePreviewKind,
    VOUCHER_ATTACHMENT_ACCEPT,
    VOUCHER_ATTACHMENT_MAX_BYTES,
    type VoucherAttachmentItem,
} from '@/lib/file-preview';

type VoucherAttachmentsProps = {
    attachments: VoucherAttachmentItem[];
    onChange: (attachments: VoucherAttachmentItem[]) => void;
    readOnly?: boolean;
    labels?: {
        title?: string;
        add?: string;
        uploading?: string;
        empty?: string;
        preview?: string;
        open?: string;
        remove?: string;
        uploadFailed?: string;
        fileTooLarge?: string;
        unsupported?: string;
    };
};

let attachmentCounter = 0;

function createAttachmentId() {
    attachmentCounter += 1;
    return `voucher-attachment-${attachmentCounter}`;
}

function AttachmentIcon({ kind }: { kind: ReturnType<typeof getFilePreviewKind> }) {
    if (kind === 'image') {
        return <ImageIcon className="h-4 w-4 text-sky-600" />;
    }

    if (kind === 'pdf' || kind === 'document') {
        return <FileText className="h-4 w-4 text-amber-700" />;
    }

    return <Paperclip className="h-4 w-4 text-gray-500" />;
}

export function VoucherAttachments({
    attachments,
    onChange,
    readOnly = false,
    labels = {},
}: VoucherAttachmentsProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [previewAttachment, setPreviewAttachment] = useState<VoucherAttachmentItem | null>(null);

    const title = labels.title ?? 'Attachments';
    const addLabel = labels.add ?? 'Add file';
    const uploadingLabel = labels.uploading ?? 'Uploading…';
    const emptyLabel = labels.empty ?? 'No attachments yet.';
    const previewLabel = labels.preview ?? 'Preview';
    const openLabel = labels.open ?? 'Open file';
    const removeLabel = labels.remove ?? 'Remove attachment';
    const uploadFailedLabel = labels.uploadFailed ?? 'Failed to upload file.';
    const fileTooLargeLabel = labels.fileTooLarge ?? 'File must be 10 MB or smaller.';
    const unsupportedLabel = labels.unsupported ?? 'Only images, PDF, and Word documents are supported.';

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        setError('');

        if (file.size > VOUCHER_ATTACHMENT_MAX_BYTES) {
            setError(fileTooLargeLabel);
            return;
        }

        const kind = getFilePreviewKind(file.type, file.name);
        if (kind === 'other') {
            setError(unsupportedLabel);
            return;
        }

        setUploading(true);

        try {
            const { url } = await api.uploadFile(file);
            onChange([
                ...attachments,
                {
                    id: createAttachmentId(),
                    url,
                    fileName: file.name,
                    mimeType: file.type || undefined,
                    fileSize: file.size,
                },
            ]);
        } catch {
            setError(uploadFailedLabel);
        } finally {
            setUploading(false);
        }
    };

    const removeAttachment = (attachmentId: string) => {
        onChange(attachments.filter((attachment) => attachment.id !== attachmentId));
    };

    const previewKind = previewAttachment
        ? getFilePreviewKind(previewAttachment.mimeType, previewAttachment.fileName)
        : null;

    return (
        <div className="rounded border bg-white p-3 space-y-2 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Paperclip className="h-3.5 w-3.5" />
                    <span>{title}</span>
                    {attachments.length > 0 ? (
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                            {attachments.length}
                        </span>
                    ) : null}
                </div>
                {!readOnly ? (
                    <>
                        <input
                            ref={inputRef}
                            type="file"
                            accept={VOUCHER_ATTACHMENT_ACCEPT}
                            className="hidden"
                            onChange={handleFileSelect}
                        />
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={uploading}
                            className="inline-flex items-center gap-1 px-2 py-1 border rounded text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                            {uploading ? uploadingLabel : addLabel}
                        </button>
                    </>
                ) : null}
            </div>

            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            {attachments.length === 0 ? (
                <p className="text-xs text-gray-400">{emptyLabel}</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {attachments.map((attachment) => {
                        const kind = getFilePreviewKind(attachment.mimeType, attachment.fileName);
                        const sizeLabel = formatFileSize(attachment.fileSize);

                        return (
                            <div
                                key={attachment.id}
                                className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 hover:bg-gray-50"
                            >
                                <button
                                    type="button"
                                    onClick={() => setPreviewAttachment(attachment)}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    aria-label={`${previewLabel} ${attachment.fileName}`}
                                >
                                    {kind === 'image' ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={attachment.url}
                                            alt={attachment.fileName}
                                            className="h-10 w-10 rounded object-cover border flex-shrink-0"
                                        />
                                    ) : (
                                        <div className="flex h-10 w-10 items-center justify-center rounded border bg-gray-50 flex-shrink-0">
                                            <AttachmentIcon kind={kind} />
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="truncate text-xs font-medium text-gray-800">{attachment.fileName}</p>
                                        {sizeLabel ? <p className="text-[10px] text-gray-400">{sizeLabel}</p> : null}
                                    </div>
                                </button>
                                {!readOnly ? (
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(attachment.id)}
                                        className="text-red-500 hover:text-red-700 flex-shrink-0"
                                        aria-label={`${removeLabel}: ${attachment.fileName}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {previewAttachment ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                    onClick={() => setPreviewAttachment(null)}
                >
                    <div
                        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-900">{previewAttachment.fileName}</p>
                                {formatFileSize(previewAttachment.fileSize) ? (
                                    <p className="text-xs text-gray-500">{formatFileSize(previewAttachment.fileSize)}</p>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <a
                                    href={previewAttachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded border px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    {openLabel}
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setPreviewAttachment(null)}
                                    className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                    aria-label="Close preview"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto bg-gray-50 p-4">
                            {previewKind === 'image' ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={previewAttachment.url}
                                    alt={previewAttachment.fileName}
                                    className="mx-auto max-h-[70vh] w-auto max-w-full rounded border bg-white object-contain"
                                />
                            ) : null}

                            {previewKind === 'pdf' ? (
                                <iframe
                                    title={previewAttachment.fileName}
                                    src={previewAttachment.url}
                                    className="h-[70vh] w-full rounded border bg-white"
                                />
                            ) : null}

                            {previewKind === 'document' ? (
                                <div className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded border bg-white px-6 text-center">
                                    <FileText className="h-12 w-12 text-amber-700" />
                                    <p className="text-sm text-gray-600">
                                        Word documents open best in a new tab. Use the Open file button above to view or download.
                                    </p>
                                    <a
                                        href={previewAttachment.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        {openLabel}
                                    </a>
                                </div>
                            ) : null}

                            {previewKind === 'other' ? (
                                <div className="flex h-[40vh] items-center justify-center rounded border bg-white text-sm text-gray-500">
                                    Preview is not available for this file type.
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function mapApiAttachments(attachments: Array<{
    id: string;
    file_url: string;
    file_name: string;
    mime_type?: string | null;
    file_size?: number | null;
}> | undefined): VoucherAttachmentItem[] {
    return (attachments ?? []).map((attachment) => ({
        id: attachment.id,
        url: attachment.file_url,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type ?? undefined,
        fileSize: attachment.file_size ?? undefined,
    }));
}

export function serializeAttachmentsForApi(attachments: VoucherAttachmentItem[]) {
    return attachments.map((attachment) => ({
        url: attachment.url,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
    }));
}