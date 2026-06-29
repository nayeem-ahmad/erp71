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
     * Delete a Cloudinary asset by its public_id.
     */
    async deleteFile(publicId: string): Promise<void> {
        if (!this.enabled) return;
        await cloudinary.uploader
            .destroy(publicId)
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
