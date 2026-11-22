/** Reads a file as a `data:` URL, the shape the upload routes take. */
export function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

export interface ShrunkImage {
    dataUrl: string;
    width: number;
    height: number;
    mimeType: 'image/jpeg';
}

/** The size a photo ends up at when its long edge is held to `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A phone photo shrunk so its long edge is at most `maxEdge` and re-encoded
 * as JPEG. A 12-megapixel shot of a receipt is 4 MB; this makes it a few
 * hundred KB, which uploads quickly and — for the AI scan — costs fewer
 * credits, because a vision model bills a picture by its pixels.
 */
export async function shrinkImage(file: Blob, maxEdge: number, quality = 0.85): Promise<ShrunkImage> {
    const url = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image decode failed'));
            img.src = url;
        });
        const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas unavailable');
        // White behind a transparent PNG, or it turns black as JPEG.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height, mimeType: 'image/jpeg' };
    } finally {
        URL.revokeObjectURL(url);
    }
}
