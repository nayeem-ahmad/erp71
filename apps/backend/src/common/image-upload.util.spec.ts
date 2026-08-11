import { BadRequestException } from '@nestjs/common';
import { parseImageUpload } from './image-upload.util';

// 1x1 transparent PNG.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('parseImageUpload', () => {
    it('accepts a bare base64 string and defaults the mime type to JPEG', () => {
        const result = parseImageUpload(PNG_BASE64);
        expect(result.mimeType).toBe('image/jpeg');
        expect(result.buffer.byteLength).toBeGreaterThan(0);
    });

    it('reads the mime type out of a data: URL', () => {
        const result = parseImageUpload(`data:image/png;base64,${PNG_BASE64}`);
        expect(result.mimeType).toBe('image/png');
    });

    it('rejects an unsupported image type', () => {
        expect(() => parseImageUpload(`data:image/gif;base64,${PNG_BASE64}`)).toThrow(
            BadRequestException,
        );
    });

    it('rejects an empty payload', () => {
        expect(() => parseImageUpload('   ')).toThrow(BadRequestException);
    });

    it('rejects a payload that is not base64 at all', () => {
        // Buffer.from never throws on junk, it just yields fewer bytes — so a
        // zero-length result is the only signal the payload was never base64.
        expect(() => parseImageUpload('!!!!')).toThrow(BadRequestException);
    });
});
