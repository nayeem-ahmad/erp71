import { BadRequestException } from '@nestjs/common';

/**
 * Turning a browser file into something `AssetsService.uploadBuffer` can store.
 *
 * Lives in common rather than beside its first caller because a second module
 * now needs it: project task attachments and import documents (a BL, a Bill of
 * Entry) have exactly the same problem — accept a file, validate it, keep a
 * `storage_key` so deleting the row can delete the file.
 */

/** What a browser can render back, plus the one document type people actually attach. */
export const ATTACHMENT_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const;

/**
 * Voice notes on a task. Matches what browsers' `MediaRecorder` produces
 * (Chrome/Firefox WebM/Ogg Opus, Safari MP4) plus common phone-recorder
 * formats for a clip recorded earlier. Kept separate from
 * `ATTACHMENT_MIME_TYPES` so import documents stay image/PDF only.
 */
export const AUDIO_ATTACHMENT_MIME_TYPES = [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
] as const;

/** Task attachments: screenshots, PDFs, and voice notes. */
export const PROJECT_ATTACHMENT_MIME_TYPES: readonly string[] = [
    ...ATTACHMENT_MIME_TYPES,
    ...AUDIO_ATTACHMENT_MIME_TYPES,
];

/** ~7 MB of base64 ≈ a 5 MB file, within the JSON body limit's headroom. */
export const MAX_ATTACHMENT_BASE64_LENGTH = 7 * 1024 * 1024;

/**
 * `audio/webm;codecs=opus` → `audio/webm`. A recorder's blob carries its codec
 * in the type, and the codec is not what decides whether we accept it.
 */
export function normaliseAttachmentMimeType(mimeType: string | undefined): string {
    return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * A PDF put through Cloudinary's image pipeline is rejected or mangled, so it
 * has to be stored raw — and deletes have to name the same resource type or
 * they silently remove nothing. Audio lives under `video` on Cloudinary: the
 * image pipeline rejects it, and `raw` would serve it without a playable type.
 */
export function resourceTypeFor(mimeType: string): 'image' | 'raw' | 'video' {
    if (mimeType.startsWith('audio/')) return 'video';
    if (mimeType === 'application/pdf') return 'raw';
    return 'image';
}

/**
 * Accepts a `data:` URL or a bare base64 string, for the same reason the CRM
 * contact-card path does: `FileReader.readAsDataURL` produces the former, and
 * expecting every caller to strip the prefix is how one of them forgets.
 *
 * `allowedTypes` defaults to the image/PDF set so import documents stay
 * unchanged; project task attachments pass `PROJECT_ATTACHMENT_MIME_TYPES`.
 */
export function parseAttachmentUpload(
    fileBase64: string,
    mimeType?: string,
    allowedTypes: readonly string[] = ATTACHMENT_MIME_TYPES,
): { buffer: Buffer; mimeType: string } {
    const raw = (fileBase64 ?? '').trim();
    if (!raw) throw new BadRequestException('No file was provided.');

    let data = raw;
    let resolved = normaliseAttachmentMimeType(mimeType);

    // `data:audio/webm;codecs=opus;base64,…` — the type is the first token;
    // optional `;param=value` pieces sit between it and `;base64,`.
    const dataUrl = raw.match(/^data:([^;,]+)(?:;[^;,]+=[^;,]*)*;base64,(.*)$/s);
    if (dataUrl) {
        resolved = normaliseAttachmentMimeType(dataUrl[1]);
        data = dataUrl[2];
    }

    if (!resolved) resolved = 'image/jpeg';
    if (!allowedTypes.includes(resolved)) {
        throw new BadRequestException(
            allowedTypes.includes('audio/webm')
                ? 'Unsupported file type. Use a JPEG, PNG, WebP, PDF or audio recording.'
                : 'Unsupported file type. Use a JPEG, PNG, WebP or PDF.',
        );
    }
    if (data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
        throw new BadRequestException('That file is too large to keep.');
    }

    const buffer = Buffer.from(data, 'base64');
    // Buffer.from never throws on junk — it returns fewer bytes — so an empty
    // result is the only signal that the payload was not base64 at all.
    if (!buffer.byteLength) throw new BadRequestException('The file could not be read.');

    return { buffer, mimeType: resolved };
}
