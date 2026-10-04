import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
    DIRECT_UPLOAD_IMAGE_FORMATS,
    DIRECT_UPLOAD_IMAGE_TRANSFORMATION,
    MAX_DIRECT_UPLOAD_BYTES,
    verifyDirectUpload as verifyDirectUploadResult,
} from './direct-upload.util';

/**
 * Everything the browser needs to post one file straight to Cloudinary.
 *
 * `params` is exactly what was signed, as strings: the browser sends each of
 * them, plus `api_key`, `signature` and the file, and nothing else — any other
 * field would break the signature, which is the point.
 */
export interface DirectUploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    /** The full folder, `retail/` included. Fixed by the signature. */
    folder: string;
    /** What every `public_id` uploaded with this signature starts with. */
    publicIdPrefix: string;
    resourceType: 'image';
    uploadUrl: string;
    params: Record<string, string>;
    allowedFormats: string[];
    maxBytes: number;
}

@Injectable()
export class AssetsService implements OnModuleInit {
    private readonly logger = new Logger(AssetsService.name);
    private enabled = false;
    /** Kept for signing direct uploads and checking what they hand back. */
    private credentials: { cloudName: string; apiKey: string; apiSecret: string } | null = null;

    onModuleInit() {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (cloudName && apiKey && apiSecret) {
            cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
            this.credentials = { cloudName, apiKey, apiSecret };
            this.enabled = true;
        } else {
            this.logger.warn('Cloudinary env vars not set — file uploads will be disabled');
        }
    }

    /**
     * Upload a file buffer to Cloudinary.
     * Files are stored under retail/<folder>/ — pass tenantId as folder.
     * Returns the secure CDN URL.
     */
    async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
        if (!this.enabled) {
            throw new Error('Cloudinary is not configured');
        }

        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: `retail/${folder}`,
                    resource_type: 'auto',      // handles images, PDFs, videos, etc.
                    use_filename: true,
                    unique_filename: true,
                    overwrite: false,
                    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
                },
                (error, result: UploadApiResponse) => {
                    if (error) return reject(error);
                    resolve(result.secure_url);
                },
            );
            stream.end(file.buffer);
        });
    }

    /**
     * Upload a raw buffer and return the asset's identity, not just its URL.
     *
     * `uploadFile` above hands back `secure_url` alone, and a URL cannot be
     * turned back into a `public_id` — so anything uploaded through it can
     * never be deleted again. Callers that keep a row pointing at the asset
     * need the `public_id` to clean up when that row goes, which is what this
     * returns.
     */
    async uploadBuffer(
        buffer: Buffer,
        folder: string,
        fileName: string,
        /**
         * `image` keeps Cloudinary's image pipeline (and its transformations).
         * `raw` is for anything it should store byte-for-byte — a PDF put
         * through the image pipeline is rejected or mangled. Defaults to
         * `image` so existing callers are untouched.
         */
        resourceType: 'image' | 'raw' = 'image',
    ): Promise<{ url: string; publicId: string; bytes: number; format?: string }> {
        if (!this.enabled) {
            throw new Error('Cloudinary is not configured');
        }

        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: `retail/${folder}`,
                    public_id: fileName,
                    resource_type: resourceType,
                    unique_filename: true,
                    overwrite: false,
                    // Transformations are an image-pipeline concept; asking for
                    // them on a raw upload is an error, not a no-op.
                    ...(resourceType === 'image'
                        ? { transformation: [{ quality: 'auto', fetch_format: 'auto' }] }
                        : {}),
                },
                (error, result?: UploadApiResponse) => {
                    if (error) return reject(error);
                    if (!result) return reject(new Error('Cloudinary returned no result'));
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        bytes: result.bytes,
                        format: result.format,
                    });
                },
            );
            stream.end(buffer);
        });
    }

    /**
     * Sign a browser's upload of one image into `retail/<folder>/`.
     *
     * The same incoming transformation and the same formats as the server-side
     * path, so where a file came from makes no difference to how it is stored.
     * No `public_id` is signed: Cloudinary picks a random one inside the folder,
     * so the browser can neither choose a name nor overwrite an existing asset.
     * The signature stays valid for Cloudinary's hour, for any number of files —
     * which is why it is only handed out behind the save route's permission.
     */
    signDirectUpload(folder: string): DirectUploadSignature {
        if (!this.enabled || !this.credentials) {
            // A 503 the browser answers by falling back to the server-side
            // route, which then fails with its own, more specific message.
            throw new ServiceUnavailableException('File storage is not configured.');
        }
        const { cloudName, apiKey, apiSecret } = this.credentials;
        const fullFolder = `retail/${folder}`;
        const timestamp = Math.floor(Date.now() / 1000);
        const params: Record<string, string> = {
            allowed_formats: DIRECT_UPLOAD_IMAGE_FORMATS.join(','),
            folder: fullFolder,
            timestamp: String(timestamp),
            transformation: DIRECT_UPLOAD_IMAGE_TRANSFORMATION,
        };
        const signature = cloudinary.utils.api_sign_request(params, apiSecret);

        return {
            cloudName,
            apiKey,
            timestamp,
            signature,
            folder: fullFolder,
            publicIdPrefix: `${fullFolder}/`,
            resourceType: 'image',
            uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
            params,
            allowedFormats: [...DIRECT_UPLOAD_IMAGE_FORMATS],
            maxBytes: MAX_DIRECT_UPLOAD_BYTES,
        };
    }

    /**
     * Check a direct-upload result before a route saves it: the asset must be
     * an image in *our* cloud, inside `retail/<folder>/` — the folder only this
     * tenant (or user) could have been signed for. See `verifyDirectUpload`.
     */
    verifyDirectUpload(
        upload: { secure_url?: unknown; public_id?: unknown },
        folder: string,
    ): { url: string; publicId: string } {
        if (!this.credentials) {
            throw new ServiceUnavailableException('File storage is not configured.');
        }
        return verifyDirectUploadResult(upload, {
            cloudName: this.credentials.cloudName,
            folder: `retail/${folder}`,
            resourceType: 'image',
        });
    }

    /** Whether uploads can run at all — lets callers fail with a clear message. */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Delete a Cloudinary asset by its public_id.
     */
    async deleteFile(publicId: string, resourceType: 'image' | 'raw' = 'image'): Promise<void> {
        if (!this.enabled) return;
        // Cloudinary keys destroy by resource type too — asking for an image
        // deletes nothing when the asset was stored raw.
        await cloudinary.uploader
            .destroy(publicId, { resource_type: resourceType })
            .catch((err) => this.logger.error(`Failed to delete ${publicId}: ${err}`));
    }

    /**
     * Build an optimised delivery URL for an existing public_id.
     * Optionally auto-crop to a given width × height.
     */
    getOptimisedUrl(publicId: string, width?: number, height?: number): string {
        return cloudinary.url(publicId, {
            fetch_format: 'auto',
            quality: 'auto',
            secure: true,
            ...(width && height ? { crop: 'auto', gravity: 'auto', width, height } : {}),
        });
    }
}
