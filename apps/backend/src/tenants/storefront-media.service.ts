import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';
import { UploadStorefrontImageDto } from '../storefront/storefront.dto';

/**
 * Folder handed to `uploadBuffer`, which prefixes `retail/` itself. Kept per
 * tenant so one shop's hero can never overwrite another's.
 */
export function storefrontMediaFolder(tenantId: string): string {
    return `${tenantId}/storefront`;
}

/**
 * Hero and logo uploads for the storefront settings page.
 *
 * Its own service rather than another method on `TenantsService`: that one is
 * the workspace's settings CRUD and has no business talking to a CDN, and the
 * upload has to happen before the settings PATCH that stores the URL — the
 * page needs something to preview and the user needs to see the crop land
 * before they commit to saving.
 */
@Injectable()
export class StorefrontMediaService {
    constructor(private readonly assets: AssetsService) {}

    /**
     * Store an already-cropped image and hand back its CDN URL.
     *
     * Only the URL: `storefront_hero_image` and `storefront_logo` are plain URL
     * columns, so there is no `public_id` to keep — replacing an image leaves
     * the old one on Cloudinary. That is the same trade the branding logo
     * already makes, and it is why the folder is per tenant: a stale asset is
     * at least attributable to the shop that uploaded it.
     */
    async upload(tenantId: string, dto: UploadStorefrontImageDto): Promise<{ url: string }> {
        const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this one will not fix
            // itself on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the image could not be saved.',
            );
        }

        const stem = (dto.fileName ?? dto.kind).replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem =
            stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || dto.kind;

        let stored: { url: string };
        try {
            stored = await this.assets.uploadBuffer(
                buffer,
                storefrontMediaFolder(tenantId),
                `${dto.kind}-${safeStem}`,
                'image',
            );
        } catch {
            throw new ServiceUnavailableException('The image could not be uploaded. Try again.');
        }

        return { url: stored.url };
    }
}
