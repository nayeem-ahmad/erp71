import { BadRequestException } from '@nestjs/common';

/** What a browser can render back, plus the one document type people attach. */
export const CHAT_ATTACHMENT_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const;

/** ~7 MB of base64 ≈ a 5 MB file, within the JSON body limit's headroom. */
export const MAX_CHAT_ATTACHMENT_BASE64_LENGTH = 7 * 1024 * 1024;

/** Attachments per message. Enough for a set of shelf photos, not a dump. */
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;

export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** How long after sending a message its author may still edit it. */
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Members in one group, counting its creator. */
export const MAX_GROUP_PARTICIPANTS = 50;

/**
 * A PDF put through Cloudinary's image pipeline is rejected or mangled, so it
 * has to be stored raw — and deletes have to name the same resource type or
 * they silently remove nothing.
 */
export function resourceTypeFor(mimeType: string): 'image' | 'raw' {
    return mimeType === 'application/pdf' ? 'raw' : 'image';
}

/**
 * The DM identity key: both user ids, sorted, joined with ':'. Sorting is the
 * whole point — without it "a:b" and "b:a" are different rows, and the unique
 * index stops preventing the duplicate thread it exists to prevent.
 */
export function buildDmKey(userIdA: string, userIdB: string): string {
    return [userIdA, userIdB].sort().join(':');
}

/**
 * What the conversation list shows under each row. Attachment-only messages
 * have an empty body, so they get a stand-in rather than a blank line.
 */
export function buildPreview(body: string, attachmentCount = 0): string {
    const trimmed = body.trim().replace(/\s+/g, ' ');
    if (trimmed) return trimmed.slice(0, 140);
    if (attachmentCount > 0) {
        return attachmentCount === 1 ? '[attachment]' : `[${attachmentCount} attachments]`;
    }
    return '';
}

/**
 * Accepts a `data:` URL or a bare base64 string, for the same reason the
 * project-attachment path does: `FileReader.readAsDataURL` produces the former,
 * and expecting every caller to strip the prefix is how one of them forgets.
 */
export function parseChatAttachmentUpload(
    fileBase64: string,
    mimeType?: string,
): { buffer: Buffer; mimeType: string } {
    const raw = (fileBase64 ?? '').trim();
    if (!raw) throw new BadRequestException('No file was provided.');

    let data = raw;
    let resolved = (mimeType ?? '').trim().toLowerCase();

    const dataUrl = raw.match(/^data:([^;,]+);base64,(.*)$/s);
    if (dataUrl) {
        resolved = dataUrl[1].toLowerCase();
        data = dataUrl[2];
    }

    if (!resolved) resolved = 'image/jpeg';
    if (!(CHAT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(resolved)) {
        throw new BadRequestException('Unsupported file type. Use a JPEG, PNG, WebP or PDF.');
    }
    if (data.length > MAX_CHAT_ATTACHMENT_BASE64_LENGTH) {
        throw new BadRequestException('That file is too large to send.');
    }

    const buffer = Buffer.from(data, 'base64');
    // Buffer.from never throws on junk — it returns fewer bytes — so an empty
    // result is the only signal that the payload was not base64 at all.
    if (!buffer.byteLength) throw new BadRequestException('The file could not be read.');

    return { buffer, mimeType: resolved };
}

/** Cloudinary public_id stem: safe characters only, bounded length. */
export function safeAttachmentStem(fileName?: string): string {
    const stem = (fileName ?? 'attachment').replace(/\.[^.]+$/, '').slice(0, 100);
    return stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

export function extensionFor(mimeType: string): string {
    return mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] ?? 'jpg');
}
