import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { parseImageUpload } from '../common/image-upload.util';
import { UploadCrmPhotoDto } from './crm-photos.dto';

/**
 * Folder handed to `uploadBuffer`, which prefixes `retail/` itself. Kept
 * separate from the prefix below so the two can never drift apart.
 */
export function crmPhotoFolder(tenantId: string): string {
    return `${tenantId}/crm-photos`;
}

/** The full `public_id` prefix a stored CRM photo must carry. */
export function crmPhotoKeyPrefix(tenantId: string): string {
    return `retail/${crmPhotoFolder(tenantId)}/`;
}

@Injectable()
export class CrmPhotosService {
    constructor(private assets: AssetsService) {}

    /**
     * Store a cropped photo and hand back both the URL and Cloudinary's
     * `public_id`.
     *
     * The `public_id` matters: a `secure_url` cannot be turned back into one,
     * so a caller that keeps only the URL can never delete the asset again.
     * That is exactly the trap VoucherAttachment and ProjectAttachment are in.
     */
    async upload(
        tenantId: string,
        dto: UploadCrmPhotoDto,
    ): Promise<{ url: string; storageKey: string }> {
        const { buffer } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this one will not fix
            // itself on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the photo could not be saved.',
            );
        }

        const stem = (dto.fileName ?? 'photo').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';

        let stored: { url: string; publicId: string };
        try {
            stored = await this.assets.uploadBuffer(buffer, crmPhotoFolder(tenantId), safeStem, 'image');
        } catch {
            throw new ServiceUnavailableException('The photo could not be uploaded. Try again.');
        }

        return { url: stored.url, storageKey: stored.publicId };
    }

    /**
     * Refuse a storage key that is not this tenant's.
     *
     * `photo_storage_key` arrives from the client and is fed straight to
     * `cloudinary.destroy` when a photo is replaced. Unchecked, tenant A could
     * point a lead at tenant B's `public_id` and delete B's asset simply by
     * changing the photo. A blank key is not an attack — it is "no photo".
     */
    assertTenantPhotoKey(tenantId: string, key: string | null | undefined): void {
        if (!key) return;
        if (!key.startsWith(crmPhotoKeyPrefix(tenantId))) {
            throw new BadRequestException('That photo does not belong to this account.');
        }
    }
}
