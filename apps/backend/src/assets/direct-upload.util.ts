import { BadRequestException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Browser → Cloudinary direct uploads: the rules both halves share.
 *
 * The browser used to send every image to the API, which sent it on to
 * Cloudinary — from Bangladesh that is a 250 ms-away hop carrying the whole
 * file, often as base64 that is a third bigger again. Now the API only signs
 * the upload (`POST /assets/upload-signature`), the browser posts the file
 * straight to Cloudinary, and the API is handed back the `secure_url` and
 * `public_id` to save.
 *
 * Those two arrive from the client, so a route that saves them has to check
 * them first: otherwise one tenant could hang another's `public_id` on its own
 * record (and later delete it, on the routes that destroy a replaced asset),
 * or point the record at any URL on the internet. `verifyDirectUpload` is that
 * check. Pure, so it can be tested without a Cloudinary account.
 */

/** Cloudinary's own names for what `IMAGE_UPLOAD_MIME_TYPES` allows on the server path. */
export const DIRECT_UPLOAD_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/**
 * The server path's ceiling — "~7 MB of base64 ≈ a 5 MB image" in
 * `image-upload.util.ts`. Cloudinary's upload API has no per-request byte cap
 * to sign, so this travels in the signature response for the browser to apply
 * before it starts; the account's own maximum image size is the hard stop.
 */
export const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The incoming transformation `AssetsService` applies to every image it
 * uploads, in the string form the SDK sends for
 * `[{ quality: 'auto', fetch_format: 'auto' }]`. Signed into direct uploads too,
 * so an image stored either way is stored the same way.
 */
export const DIRECT_UPLOAD_IMAGE_TRANSFORMATION = 'f_auto,q_auto';

/** Where a product's main and gallery images land. Per tenant, like every other folder. */
export function productImageFolder(tenantId: string): string {
    return `${tenantId}/products`;
}

/** Logos and header/footer images for print templates. */
export function printTemplateImageFolder(tenantId: string): string {
    return `${tenantId}/print-templates`;
}

/**
 * A user's avatars. Per user, not per tenant: the avatar is the person's and
 * follows them into every workspace. The same folder `AuthService.updateAvatar`
 * has always uploaded to.
 */
export function avatarFolder(userId: string): string {
    return `avatars/${userId}`;
}

/**
 * What Cloudinary hands the browser back, as a save route receives it. Both
 * optional so a route can take it *beside* its existing payload — the base64 or
 * multipart body the mobile app and older clients still send.
 */
export class CloudinaryUploadDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    secure_url?: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    public_id?: string;
}

/** True when the body carries a direct-upload result rather than the old payload. */
export function isDirectUpload(body: { secure_url?: unknown; public_id?: unknown } | null | undefined): boolean {
    return Boolean(body && (body.secure_url !== undefined || body.public_id !== undefined));
}

/**
 * Cloudinary's random ids are alphanumeric and our folders are tenant UUIDs and
 * plain words, so anything else — a dot, a space, a `..` — is not one of ours.
 */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_\-/]+$/;

export interface DirectUploadExpectation {
    /** `CLOUDINARY_CLOUD_NAME` — the only cloud a saved URL may point at. */
    cloudName: string;
    /** The full folder, `retail/` included, the signature put the file in. */
    folder: string;
    resourceType: 'image';
}

/**
 * Accept a direct-upload result only if it is an asset this tenant (or user)
 * could have uploaded for this purpose.
 *
 * - `public_id` sits inside `folder` — the folder the signature fixed, which
 *   the browser cannot change without breaking the signature.
 * - `secure_url` is `https://res.cloudinary.com/<our cloud>/image/upload/`,
 *   then an optional version, then that same `public_id` and an extension —
 *   nothing else, so the URL cannot name one asset while the id names another,
 *   and cannot carry transformations, a query string or another host.
 *
 * Returns the URL as parsed, which is the exact string that was checked.
 */
export function verifyDirectUpload(
    upload: { secure_url?: unknown; public_id?: unknown },
    expected: DirectUploadExpectation,
): { url: string; publicId: string } {
    const publicId = typeof upload.public_id === 'string' ? upload.public_id.trim() : '';
    const secureUrl = typeof upload.secure_url === 'string' ? upload.secure_url.trim() : '';
    if (!publicId || !secureUrl) {
        throw new BadRequestException('The uploaded image is missing its address.');
    }

    const prefix = `${expected.folder.replace(/\/+$/, '')}/`;
    if (
        !PUBLIC_ID_PATTERN.test(publicId) ||
        publicId.includes('//') ||
        !publicId.startsWith(prefix) ||
        publicId.length === prefix.length
    ) {
        throw new BadRequestException('That image does not belong to this account.');
    }

    let parsed: URL;
    try {
        parsed = new URL(secureUrl);
    } catch {
        throw new BadRequestException('That image was not uploaded to this account’s storage.');
    }

    const base = `/${expected.cloudName}/${expected.resourceType}/upload/`;
    const notOurs =
        !expected.cloudName ||
        parsed.protocol !== 'https:' ||
        parsed.hostname !== 'res.cloudinary.com' ||
        parsed.port !== '' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== '' ||
        !parsed.pathname.startsWith(base);
    if (notOurs) {
        throw new BadRequestException('That image was not uploaded to this account’s storage.');
    }

    // What follows the base is `v<digits>/` (optional) and then the asset:
    // exactly the public_id, with or without its format extension.
    const asset = parsed.pathname.slice(base.length).replace(/^v\d+\//, '');
    const extension = asset.slice(publicId.length);
    if (!asset.startsWith(publicId) || !(extension === '' || /^\.[A-Za-z0-9]{1,5}$/.test(extension))) {
        throw new BadRequestException('That image was not uploaded to this account’s storage.');
    }

    return { url: parsed.href, publicId };
}
