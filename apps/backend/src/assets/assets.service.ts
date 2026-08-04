import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class AssetsService implements OnModuleInit {
    private readonly logger = new Logger(AssetsService.name);
    private enabled = false;

    onModuleInit() {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (cloudName && apiKey && apiSecret) {
            cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
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
