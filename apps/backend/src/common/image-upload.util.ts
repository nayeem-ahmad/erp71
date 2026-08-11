import { BadRequestException } from '@nestjs/common';

/** What Cloudinary is asked to store, and what a browser can render back. */
export const IMAGE_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** ~7 MB of base64 ≈ a 5 MB image, just under the 5 MB JSON body limit's headroom. */
export const MAX_IMAGE_UPLOAD_BASE64_LENGTH = 7 * 1024 * 1024;

/**
 * Turn the browser's payload into bytes.
 *
 * Accepts a `data:` URL or a bare base64 string for the same reason the scan
 * route does — `FileReader.readAsDataURL` produces the former and expecting
 * every caller to strip the prefix is how one of them eventually forgets.
 */
export function parseImageUpload(
    imageBase64: string,
    mimeType?: string,
): { buffer: Buffer; mimeType: string } {
    const raw = (imageBase64 ?? '').trim();
    if (!raw) throw new BadRequestException('No image was provided.');

    let data = raw;
    let resolved = (mimeType ?? '').trim().toLowerCase();

    const dataUrl = raw.match(/^data:([^;,]+);base64,(.*)$/s);
    if (dataUrl) {
        resolved = dataUrl[1].toLowerCase();
        data = dataUrl[2];
    }

    if (!resolved) resolved = 'image/jpeg';
    if (!IMAGE_UPLOAD_MIME_TYPES.includes(resolved)) {
        throw new BadRequestException('Unsupported image type. Use a JPEG, PNG, or WebP image.');
    }
    if (data.length > MAX_IMAGE_UPLOAD_BASE64_LENGTH) {
        throw new BadRequestException('Image is too large to keep.');
    }

    const buffer = Buffer.from(data, 'base64');
    // Buffer.from never throws on junk — it just returns fewer bytes — so an
    // empty result is the only signal that the payload was not base64 at all.
    if (!buffer.byteLength) throw new BadRequestException('The image could not be read.');

    return { buffer, mimeType: resolved };
}
