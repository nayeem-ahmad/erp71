import { renderHook } from '@testing-library/react';
import { useNoteImageUpload } from './useNoteImageUpload';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
});
jest.mock('@/lib/api', () => ({ api: { uploadNoteImage: jest.fn() } }));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const direct = jest.fn();
jest.mock('@/lib/uploads/direct-upload', () => {
    const actual = jest.requireActual('@/lib/uploads/direct-upload');
    return { ...actual, directUploader: (purpose: string) => (file: Blob) => direct(purpose, file) };
});

const { api } = jest.requireMock('@/lib/api') as { api: { uploadNoteImage: jest.Mock } };
const { toast } = jest.requireMock('@/lib/toast') as { toast: { error: jest.Mock } };

const png = (bytes = 10, name = 'shelf.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

afterEach(() => jest.clearAllMocks());

describe('useNoteImageUpload', () => {
    it('uploads straight to Cloudinary under the note-image purpose', async () => {
        direct.mockResolvedValue({ secure_url: 'https://res.cloudinary.com/c/image/upload/v1/retail/t/notes/a.png', public_id: 'retail/t/notes/a' });
        const { result } = renderHook(() => useNoteImageUpload());

        await expect(result.current(png())).resolves.toEqual({
            url: 'https://res.cloudinary.com/c/image/upload/v1/retail/t/notes/a.png',
            name: 'shelf',
        });
        expect(direct).toHaveBeenCalledWith('note-image', expect.any(File));
        expect(api.uploadNoteImage).not.toHaveBeenCalled();
    });

    it('falls back to the server route when the direct upload fails', async () => {
        direct.mockRejectedValue(new Error('blocked'));
        api.uploadNoteImage.mockResolvedValue({ url: 'https://res.cloudinary.com/c/b.png', storageKey: 'retail/t/notes/b' });
        const { result } = renderHook(() => useNoteImageUpload());

        await expect(result.current(png())).resolves.toEqual({ url: 'https://res.cloudinary.com/c/b.png', name: 'shelf' });
        expect(api.uploadNoteImage).toHaveBeenCalledWith(
            expect.objectContaining({ mimeType: 'image/png', fileName: 'shelf.png', imageBase64: expect.stringMatching(/^data:image\/png;base64,/) }),
        );
    });

    it('refuses a type or size it cannot keep, before uploading anything', async () => {
        const { result } = renderHook(() => useNoteImageUpload());

        await expect(result.current(new File(['x'], 'a.gif', { type: 'image/gif' }))).resolves.toBeNull();
        await expect(result.current(png(5 * 1024 * 1024 + 1))).resolves.toBeNull();

        expect(direct).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Use a JPEG, PNG or WebP picture.');
        expect(toast.error).toHaveBeenCalledWith('Pictures must be 5 MB or smaller.');
    });

    it('reports a failed upload and hands back null so the editor drops the placeholder', async () => {
        direct.mockRejectedValue(new Error('blocked'));
        api.uploadNoteImage.mockRejectedValue(new Error('Storage is down'));
        const { result } = renderHook(() => useNoteImageUpload());

        await expect(result.current(png())).resolves.toBeNull();
        expect(toast.error).toHaveBeenCalledWith('Storage is down');
    });
});
