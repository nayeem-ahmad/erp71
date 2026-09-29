import { ServiceUnavailableException } from '@nestjs/common';
import type { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';

/**
 * The upload half of a canvas background, shared by the two canvases that have
 * one: a board and a sprint. Both store the same three columns and follow the
 * same rules — one background at a time, and the Cloudinary `public_id` kept so
 * a replaced picture can be deleted rather than billed forever — so the only
 * thing that differs between them is the folder the file lands in.
 */

/** An uploaded background, as `FileReader.readAsDataURL` produces it. */
export interface BackgroundImageUpload {
    /** A `data:` URL or a bare base64 string. */
    imageBase64: string;
    mimeType?: string;
    fileName?: string;
}

/** The three columns a background is, all cleared — the plain canvas. */
export const NO_BACKGROUND = {
    background_color: null,
    background_image_url: null,
    background_image_key: null,
} as const;

/**
 * A row on its way to the browser.
 *
 * `background_image_key` is the Cloudinary `public_id` and is the server's
 * business only — it is how a replaced picture gets deleted, and the browser
 * has no use for it. Stripped here rather than by a `select` so the mutation
 * responses keep the rest of the row exactly as they always returned it, and so
 * one function is the single place that decides this.
 */
export function withoutStorageKey<T extends { background_image_key?: string | null }>(row: T) {
    const { background_image_key: _key, ...rest } = row;
    return rest;
}

/**
 * Validate and upload a background image, returning where it landed.
 *
 * Throws before anything is stored if the payload is not an image or storage is
 * not configured, so the caller only ever writes a row for a file that exists.
 */
export async function uploadBackgroundImage(
    assets: AssetsService,
    folder: string,
    dto: BackgroundImageUpload,
): Promise<{ url: string; publicId: string }> {
    const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

    if (!assets.isEnabled()) {
        // Distinguishable from a transient failure: this will not fix itself
        // on retry, and the operator needs to know why.
        throw new ServiceUnavailableException(
            'File storage is not configured, so the background could not be saved.',
        );
    }

    const stem = (dto.fileName ?? 'background').replace(/\.[^.]+$/, '').slice(0, 100);
    const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'background';

    try {
        return await assets.uploadBuffer(buffer, folder, safeStem, 'image');
    } catch {
        throw new ServiceUnavailableException('The background could not be uploaded.');
    }
}
