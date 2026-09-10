import type { Area } from 'react-easy-crop';

function createImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', (error) => reject(error));
        image.crossOrigin = 'anonymous';
        image.src = url;
    });
}

export async function getCroppedImageBlob(
    imageSrc: string,
    pixelCrop: Area,
    mimeType = 'image/jpeg',
    /**
     * Longest-edge ceiling for the result, in pixels. The crop is scaled down
     * to fit; omit it to keep the cropped region at its own size.
     *
     * Worth setting for anything that is uploaded: a phone photo cropped at
     * full resolution re-encodes to megabytes, which both overruns the API's
     * 5 MB JSON body limit once base64 has inflated it by a third, and would
     * be served at that size to every visitor afterwards.
     */
    maxEdge?: number,
): Promise<Blob> {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Canvas is not supported');
    }

    const longestEdge = Math.max(pixelCrop.width, pixelCrop.height);
    // Never scales up: a crop already smaller than the ceiling is left alone.
    const scale = maxEdge && longestEdge > maxEdge ? maxEdge / longestEdge : 1;
    const width = Math.max(Math.round(pixelCrop.width * scale), 1);
    const height = Math.max(Math.round(pixelCrop.height * scale), 1);

    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        width,
        height,
    );

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error('Failed to crop image'));
                    return;
                }
                resolve(blob);
            },
            mimeType,
            0.92,
        );
    });
}