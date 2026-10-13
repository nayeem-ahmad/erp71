import { BadRequestException } from '@nestjs/common';
import {
    MAX_SUPPORT_ATTACHMENT_BYTES,
    normaliseMimeType,
    prepareSupportAttachments,
    supportResourceTypeFor,
} from './support-attachment.util';
import { describeAttachments, supportStorageName } from './support.service';

const file = (originalname: string, mimetype: string, size = 4) => ({
    buffer: Buffer.alloc(Math.min(size, 16), 1),
    originalname,
    mimetype,
    size,
});

describe('normaliseMimeType', () => {
    it('drops the codec a recorder adds', () => {
        expect(normaliseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
        expect(normaliseMimeType(' Image/PNG ')).toBe('image/png');
        expect(normaliseMimeType(undefined)).toBe('');
    });
});

describe('supportResourceTypeFor', () => {
    it('keeps audio under video, PDFs raw and images as images', () => {
        expect(supportResourceTypeFor('audio/mp4')).toBe('video');
        expect(supportResourceTypeFor('application/pdf')).toBe('raw');
        expect(supportResourceTypeFor('image/jpeg')).toBe('image');
    });
});

describe('prepareSupportAttachments', () => {
    it('is empty when nothing was sent', () => {
        expect(prepareSupportAttachments(undefined)).toEqual([]);
    });

    it('marks audio as a voice note', () => {
        const [voice, shot] = prepareSupportAttachments([
            file('voice-note.ogg', 'audio/ogg;codecs=opus'),
            file('shot.jpg', 'image/jpeg'),
        ]);
        expect(voice).toMatchObject({ kind: 'voice', mimeType: 'audio/ogg', resourceType: 'video' });
        expect(shot).toMatchObject({ kind: 'file', mimeType: 'image/jpeg', resourceType: 'image' });
    });

    it('refuses more than five files', () => {
        const six = Array.from({ length: 6 }, (_, i) => file(`${i}.png`, 'image/png'));
        expect(() => prepareSupportAttachments(six)).toThrow(BadRequestException);
    });

    it('refuses an oversize file', () => {
        expect(() =>
            prepareSupportAttachments([file('huge.png', 'image/png', MAX_SUPPORT_ATTACHMENT_BYTES + 1)]),
        ).toThrow(BadRequestException);
    });

    it('refuses an empty file and an unknown type', () => {
        expect(() => prepareSupportAttachments([{ ...file('a.png', 'image/png'), size: 0 }])).toThrow(
            BadRequestException,
        );
        expect(() => prepareSupportAttachments([file('a.svg', 'image/svg+xml')])).toThrow(BadRequestException);
    });
});

describe('describeAttachments', () => {
    it('names what came in place of a message', () => {
        expect(describeAttachments([{ kind: 'voice' }])).toBe('(Voice note)');
        expect(describeAttachments([{ kind: 'file' }, { kind: 'file' }])).toBe('(2 attachments)');
        expect(describeAttachments([{ kind: 'voice' }, { kind: 'file' }])).toBe('(Voice note + 1 attachment)');
    });
});

describe('supportStorageName', () => {
    it('never repeats for the same file name', () => {
        const file = { fileName: 'image.png', kind: 'file' as const, resourceType: 'image' as const };
        const a = supportStorageName(file);
        expect(a).toMatch(/^image-[0-9a-f]{8}$/);
        expect(supportStorageName(file)).not.toBe(a);
    });

    it('keeps a raw file\'s extension and cleans the name', () => {
        expect(
            supportStorageName({ fileName: 'Bill of sale (1).PDF', kind: 'file', resourceType: 'raw' }),
        ).toMatch(/^Bill_of_sale_1_-[0-9a-f]{8}\.pdf$/);
    });
});
