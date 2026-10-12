import { api } from '@/lib/api';

/**
 * Browser → Cloudinary direct uploads.
 *
 * An image used to travel Bangladesh → our API (≈250 ms away) → Cloudinary,
 * often as base64 inside JSON, a third bigger than the file. Now the API only
 * signs the upload (`POST /assets/upload-signature`, a few hundred bytes each
 * way), the file goes straight to Cloudinary, and the API is handed back the
 * `secure_url`/`public_id` to save — which it checks belong to this tenant
 * before it does.
 *
 * Every caller keeps its old server route as a fallback (`withServerFallback`):
 * a network that blocks Cloudinary, a signature the API will not give, or a
 * file Cloudinary refuses all end in the upload the app made before, so nothing
 * that worked yesterday stops working.
 */

/** Mirrors the backend's `UPLOAD_PURPOSES` — each maps to one folder and one permission. */
export type UploadPurpose =
    | 'product-image'
    | 'print-template-image'
    | 'storefront-image'
    | 'crm-photo'
    | 'board-background'
    | 'sprint-background'
    | 'avatar';

/** What `POST /assets/upload-signature` returns. */
export interface UploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    publicIdPrefix: string;
    resourceType: 'image';
    uploadUrl: string;
    /** Exactly what was signed: sent as-is, and nothing else may be added. */
    params: Record<string, string>;
    allowedFormats: string[];
    maxBytes: number;
}

/** What Cloudinary hands back, and what a save route accepts in place of the file. */
export interface CloudinaryUpload {
    secure_url: string;
    public_id: string;
}

export type DirectUploadFailure =
    /** Not a file Cloudinary would take with this signature — too big, wrong type. */
    | 'unsupported'
    /** Cloudinary could not be reached, or stopped answering. */
    | 'network'
    /** Cloudinary answered, and said no. */
    | 'rejected'
    /** An earlier upload already found Cloudinary unreachable this session. */
    | 'unavailable';

export class DirectUploadError extends Error {
    constructor(
        message: string,
        readonly reason: DirectUploadFailure,
    ) {
        super(message);
        this.name = 'DirectUploadError';
    }
}

/** The same ceiling the server path holds an image to (`MAX_DIRECT_UPLOAD_BYTES`). */
export const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024;

/** MIME type → the format name Cloudinary's `allowed_formats` uses. */
const FORMAT_OF: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

/**
 * Generous on purpose — this is the "something is wrong" line, not a speed
 * target. 30 s to get going plus 16 KB/s, the floor of a poor mobile link:
 * a 5 MB image gets about six minutes before it is given up on.
 */
function timeoutFor(bytes: number): number {
    return 30_000 + Math.ceil(bytes / 16_384) * 1_000;
}

/**
 * Set when Cloudinary could not be reached, so the next upload goes straight
 * to the server instead of waiting out the same failure again. Lasts until the
 * page reloads; at worst that is a session of uploads the way they always went.
 */
let cloudinaryUnreachable = false;

/** For tests: forget that Cloudinary was unreachable. */
export function resetDirectUploadAvailability(): void {
    cloudinaryUnreachable = false;
}

/**
 * Refuse, before anything is sent, a file this signature cannot carry — no
 * point spending the upload to be told so.
 */
function assertUploadable(file: Blob, maxBytes: number, allowedFormats: readonly string[]): void {
    if (file.size > maxBytes) {
        throw new DirectUploadError('That image is too large.', 'unsupported');
    }
    // An empty type (some pasted or HEIC files) is left for Cloudinary to judge.
    const format = file.type ? FORMAT_OF[file.type.toLowerCase()] : undefined;
    if (file.type && (!format || !allowedFormats.includes(format))) {
        throw new DirectUploadError('That image type cannot be uploaded directly.', 'unsupported');
    }
}

/**
 * Post one file to Cloudinary with a signature from the API.
 *
 * `fetch` with a `FormData` body and no custom headers is a CORS "simple"
 * request, so there is no preflight — one fewer round trip to Cloudinary than
 * an XHR with upload-progress listeners would cost. Nothing in the app shows
 * upload progress, so nothing is lost.
 */
export async function uploadToCloudinary(file: Blob, signature: UploadSignature): Promise<CloudinaryUpload> {
    assertUploadable(file, signature.maxBytes, signature.allowedFormats);

    const form = new FormData();
    form.append('file', file);
    form.append('api_key', signature.apiKey);
    form.append('signature', signature.signature);
    for (const [key, value] of Object.entries(signature.params)) {
        form.append(key, value);
    }

    // Built here from the cloud name rather than taken from `uploadUrl`: the
    // only place a file may go is Cloudinary's upload API.
    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloudName)}/${signature.resourceType}/upload`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutFor(file.size));
    let response: Response;
    try {
        response = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    } catch {
        cloudinaryUnreachable = true;
        throw new DirectUploadError('Cloudinary could not be reached.', 'network');
    } finally {
        clearTimeout(timer);
    }

    let body: { secure_url?: unknown; public_id?: unknown; error?: { message?: unknown } } | null = null;
    try {
        body = await response.json();
    } catch {
        // Not JSON — handled as a refusal below.
    }

    if (!response.ok) {
        const message = typeof body?.error?.message === 'string' ? body.error.message : `Upload refused (${response.status}).`;
        throw new DirectUploadError(message, 'rejected');
    }
    if (typeof body?.secure_url !== 'string' || typeof body?.public_id !== 'string') {
        throw new DirectUploadError('Cloudinary did not say where the image went.', 'rejected');
    }
    return { secure_url: body.secure_url, public_id: body.public_id };
}

/**
 * An uploader for one batch: the signature is fetched once, on the first file,
 * and reused for the rest — a ten-picture gallery pays for one signature round
 * trip, not ten. A signature is good for Cloudinary's hour, far longer than a
 * batch takes.
 */
export function directUploader(purpose: UploadPurpose): (file: Blob) => Promise<CloudinaryUpload> {
    let signature: Promise<UploadSignature> | null = null;

    return async (file: Blob) => {
        if (cloudinaryUnreachable) {
            throw new DirectUploadError('Cloudinary was unreachable earlier.', 'unavailable');
        }
        // The cheap checks first, so a file that cannot go direct does not
        // cost a signature request on the way to the fallback.
        assertUploadable(file, MAX_DIRECT_UPLOAD_BYTES, Object.values(FORMAT_OF));

        signature ??= api.getUploadSignature(purpose);
        return uploadToCloudinary(file, await signature);
    };
}

/** Upload one file straight to Cloudinary. */
export function directUpload(file: Blob, purpose: UploadPurpose): Promise<CloudinaryUpload> {
    return directUploader(purpose)(file);
}

/**
 * Try the direct upload; if any part of it fails, take the old server route —
 * once. A failure there is the caller's to report, exactly as before.
 */
export async function withServerFallback<T>(
    direct: () => Promise<T>,
    fallback: () => Promise<T>,
): Promise<T> {
    try {
        return await direct();
    } catch {
        return fallback();
    }
}
