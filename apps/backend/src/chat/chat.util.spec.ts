import { BadRequestException } from '@nestjs/common';
import {
    buildDmKey,
    buildPreview,
    extensionFor,
    parseChatAttachmentUpload,
    resourceTypeFor,
    safeAttachmentStem,
} from './chat.util';

describe('buildDmKey', () => {
    it('is stable regardless of argument order', () => {
        // The whole point of sorting: without it "a:b" and "b:a" are different
        // rows and the unique index stops preventing duplicate DM threads.
        expect(buildDmKey('bbb', 'aaa')).toBe(buildDmKey('aaa', 'bbb'));
        expect(buildDmKey('aaa', 'bbb')).toBe('aaa:bbb');
    });
});

describe('buildPreview', () => {
    it('collapses whitespace and truncates', () => {
        expect(buildPreview('  hello\n\n  world  ')).toBe('hello world');
        expect(buildPreview('x'.repeat(200))).toHaveLength(140);
    });

    it('stands in for an attachment-only message', () => {
        expect(buildPreview('', 1)).toBe('[attachment]');
        expect(buildPreview('   ', 3)).toBe('[3 attachments]');
    });

    it('prefers the caption when there is one', () => {
        expect(buildPreview('look at this', 2)).toBe('look at this');
    });

    it('is empty when there is nothing at all', () => {
        expect(buildPreview('')).toBe('');
    });
});

describe('resourceTypeFor', () => {
    it('stores PDFs raw and images through the image pipeline', () => {
        // A PDF put through Cloudinary's image pipeline is rejected or mangled.
        expect(resourceTypeFor('application/pdf')).toBe('raw');
        expect(resourceTypeFor('image/png')).toBe('image');
    });
});

describe('parseChatAttachmentUpload', () => {
    const pngBase64 = Buffer.from('fake-png-bytes').toString('base64');

    it('accepts a data URL and takes its mime type', () => {
        const result = parseChatAttachmentUpload(`data:image/png;base64,${pngBase64}`);
        expect(result.mimeType).toBe('image/png');
        expect(result.buffer.toString()).toBe('fake-png-bytes');
    });

    it('accepts a bare base64 string with an explicit mime type', () => {
        const result = parseChatAttachmentUpload(pngBase64, 'image/webp');
        expect(result.mimeType).toBe('image/webp');
    });

    it('rejects an unsupported type', () => {
        expect(() =>
            parseChatAttachmentUpload(`data:application/zip;base64,${pngBase64}`),
        ).toThrow(BadRequestException);
    });

    it('rejects an empty payload', () => {
        expect(() => parseChatAttachmentUpload('')).toThrow(BadRequestException);
    });

    it('rejects a payload that is not base64 at all', () => {
        // Buffer.from never throws on junk — it returns fewer bytes — so an
        // empty result is the only signal available.
        expect(() => parseChatAttachmentUpload('!!!!', 'image/png')).toThrow(BadRequestException);
    });

    it('rejects a file over the size ceiling', () => {
        const huge = 'A'.repeat(7 * 1024 * 1024 + 4);
        expect(() => parseChatAttachmentUpload(huge, 'image/png')).toThrow(BadRequestException);
    });
});

describe('safeAttachmentStem', () => {
    it('strips the extension and unsafe characters', () => {
        expect(safeAttachmentStem('Shelf Photo (2).JPG')).toBe('Shelf-Photo-2');
    });

    it('falls back when nothing usable survives', () => {
        expect(safeAttachmentStem('###.png')).toBe('attachment');
        expect(safeAttachmentStem(undefined)).toBe('attachment');
    });
});

describe('extensionFor', () => {
    it('maps mime types to a file extension', () => {
        expect(extensionFor('application/pdf')).toBe('pdf');
        expect(extensionFor('image/webp')).toBe('webp');
    });
});
