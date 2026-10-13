import { BadRequestException } from '@nestjs/common';

/**
 * What a ticket can carry: screenshots and photos, a PDF, and voice notes.
 *
 * Audio is listed by what browsers' `MediaRecorder` actually produces — Chrome
 * and Firefox record WebM/Ogg Opus, Safari records MP4/AAC — plus the common
 * formats a phone's own recorder app saves, for someone attaching a clip they
 * recorded earlier.
 */
export const SUPPORT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const SUPPORT_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;
export const SUPPORT_AUDIO_MIME_TYPES = [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
] as const;

export const SUPPORT_ATTACHMENT_MIME_TYPES: readonly string[] = [
    ...SUPPORT_IMAGE_MIME_TYPES,
    ...SUPPORT_DOCUMENT_MIME_TYPES,
    ...SUPPORT_AUDIO_MIME_TYPES,
];

/** Per file. A phone screenshot is ~1 MB; five minutes of Opus is ~2.5 MB. */
export const MAX_SUPPORT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Per message. Enough for a few screenshots and a voice note. */
export const MAX_SUPPORT_ATTACHMENTS = 5;

export type SupportAttachmentKind = 'file' | 'voice';
export type SupportResourceType = 'image' | 'raw' | 'video';

/** The shape Multer hands a controller for each uploaded file. */
export interface SupportUploadFile {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
}

/** A validated upload, ready for storage. */
export interface PreparedSupportAttachment {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    size: number;
    kind: SupportAttachmentKind;
    resourceType: SupportResourceType;
}

/**
 * `audio/webm;codecs=opus` → `audio/webm`. A recorder's blob carries its codec
 * in the type, and the codec is not what decides whether we accept it.
 */
export function normaliseMimeType(mimeType: string | undefined): string {
    return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Cloudinary files audio under `video` — the image pipeline rejects it, and
 * `raw` would serve it without a playable content type. A PDF goes `raw`
 * because the image pipeline mangles it.
 */
export function supportResourceTypeFor(mimeType: string): SupportResourceType {
    if (mimeType.startsWith('audio/')) return 'video';
    if (mimeType === 'application/pdf') return 'raw';
    return 'image';
}

/**
 * Check every upload before any is stored, so a bad fifth file does not leave
 * four orphans in Cloudinary behind a rejected request.
 */
export function prepareSupportAttachments(
    files: SupportUploadFile[] | undefined,
): PreparedSupportAttachment[] {
    const list = files ?? [];
    if (list.length > MAX_SUPPORT_ATTACHMENTS) {
        throw new BadRequestException(`Attach at most ${MAX_SUPPORT_ATTACHMENTS} files.`);
    }

    return list.map((file) => {
        const mimeType = normaliseMimeType(file.mimetype);
        if (!SUPPORT_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
            throw new BadRequestException(
                'Unsupported file type. Attach an image (JPEG, PNG, WebP, GIF), a PDF or an audio recording.',
            );
        }
        if (!file.size || !file.buffer?.byteLength) {
            throw new BadRequestException(`"${file.originalname}" is empty.`);
        }
        if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) {
            throw new BadRequestException(`"${file.originalname}" is larger than 10 MB.`);
        }

        const kind: SupportAttachmentKind = mimeType.startsWith('audio/') ? 'voice' : 'file';
        return {
            buffer: file.buffer,
            fileName: (file.originalname || (kind === 'voice' ? 'voice-note' : 'attachment')).slice(0, 200),
            mimeType,
            size: file.size,
            kind,
            resourceType: supportResourceTypeFor(mimeType),
        };
    });
}

/** What a thread view needs to show an attachment. */
export function serializeSupportAttachment(a: {
    id: string;
    kind: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
}) {
    return {
        id: a.id,
        kind: a.kind,
        url: a.fileUrl,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
    };
}
