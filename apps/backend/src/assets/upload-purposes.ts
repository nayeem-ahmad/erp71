import { StorePermission } from '@erp71/shared-types';
import { CRM_WRITE, PRODUCT_WRITE, SETTINGS_ADMIN } from '../auth/permission-sets';
import { crmPhotoFolder } from '../crm-photos/crm-photos.service';
import { boardBackgroundFolder } from '../projects/boards.service';
import { sprintBackgroundFolder } from '../projects/sprints.service';
import { storefrontMediaFolder } from '../tenants/storefront-media.service';
import { avatarFolder, printTemplateImageFolder, productImageFolder } from './direct-upload.util';

/**
 * Every kind of image the browser may upload straight to Cloudinary, and for
 * each one: the folder it lands in and who may sign for it.
 *
 * The folder comes from the same function the server-side upload uses — never
 * a second copy of the string — so a file uploaded either way lands in the
 * same place and passes the same `public_id` prefix check on save.
 *
 * The permissions are the ones the route that *saves* the image requires.
 * A signature lets its holder put files in that folder, so it is handed only
 * to someone who could then use them; signing for a purpose you cannot save is
 * refused rather than left to fail later.
 */
export interface UploadPurposeRule {
    folder: (ctx: { tenantId: string; userId: string }) => string;
    /** Any one of these is enough; OWNER always passes. `null`: every member — the upload is their own. */
    permissions: StorePermission[] | null;
}

export const UPLOAD_PURPOSES = {
    /** Product main image and gallery — saved through `POST/PATCH /products`. */
    'product-image': {
        folder: ({ tenantId }) => productImageFolder(tenantId),
        permissions: PRODUCT_WRITE,
    },
    /** Print-template logo and header/footer images — saved with the template. */
    'print-template-image': {
        folder: ({ tenantId }) => printTemplateImageFolder(tenantId),
        permissions: SETTINGS_ADMIN,
    },
    /** Storefront hero and logo — saved through `PATCH /tenants/storefront-settings`. */
    'storefront-image': {
        folder: ({ tenantId }) => storefrontMediaFolder(tenantId),
        permissions: SETTINGS_ADMIN,
    },
    /** Lead and contact photos — the key is checked by `assertTenantPhotoKey` on save. */
    'crm-photo': {
        folder: ({ tenantId }) => crmPhotoFolder(tenantId),
        permissions: CRM_WRITE,
    },
    /** `PUT /projects/boards/:id/background/image`. */
    'board-background': {
        folder: ({ tenantId }) => boardBackgroundFolder(tenantId),
        permissions: [StorePermission.MANAGE_PROJECTS],
    },
    /** `PUT /sprints/:id/background/image`. */
    'sprint-background': {
        folder: ({ tenantId }) => sprintBackgroundFolder(tenantId),
        permissions: [StorePermission.MANAGE_SPRINTS],
    },
    /** `PATCH /auth/me/avatar` — the signed-in user's own picture. */
    avatar: {
        folder: ({ userId }) => avatarFolder(userId),
        permissions: null,
    },
} satisfies Record<string, UploadPurposeRule>;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export const UPLOAD_PURPOSE_NAMES = Object.keys(UPLOAD_PURPOSES) as UploadPurpose[];

export function isUploadPurpose(value: unknown): value is UploadPurpose {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UPLOAD_PURPOSES, value);
}
