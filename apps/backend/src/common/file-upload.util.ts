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

/** ~7 MB of base64 ≈ a 5 MB file, within the JSON body limit's headroom. */
export const MAX_ATTACHMENT_BASE64_LENGTH = 7 * 1024 * 1024;

/**
 * A PDF put through Cloudinary's image pipeline is rejected or mangled, so it
 * has to be stored raw — and deletes have to name the same resource type or
 * they silently remove nothing.
 */
export function resourceTypeFor(mimeType: string): 'image' | 'raw' {
    return mimeType === 'application/pdf' ? 'raw' : 'image';
}

/**
 * Accepts a `data:` URL or a bare base64 string, for the same reason the CRM
 * contact-card path does: `FileReader.readAsDataURL` produces the former, and
 * expecting every caller to strip the prefix is how one of them forgets.
 */
export function parseAttachmentUpload(
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
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(resolved)) {
        throw new BadRequestException('Unsupported file type. Use a JPEG, PNG, WebP or PDF.');
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
