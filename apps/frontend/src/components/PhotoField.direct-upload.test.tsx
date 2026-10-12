import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetDirectUploadAvailability } from '@/lib/uploads/direct-upload';
import PhotoField, { type PhotoValue } from './PhotoField';

/**
 * PhotoField with the real direct-upload helper behind it: the photo goes
 * straight to Cloudinary, and the base64 route is the fallback when it cannot.
 * Only the API client and the network are faked.
 */

const mockGetUploadSignature = jest.fn();
const mockUploadCrmPhoto = jest.fn();
jest.mock('@/lib/api', () => ({
    api: {
        getUploadSignature: (...args: any[]) => mockGetUploadSignature(...args),
        uploadCrmPhoto: (...args: any[]) => mockUploadCrmPhoto(...args),
    },
}));

const mockToastError = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: { error: (...args: any[]) => mockToastError(...args) },
}));

// As in PhotoField.test.tsx: the cropper is reduced to a button that hands
// back a cropped file.
jest.mock('./AvatarCropModal', () => ({
    __esModule: true,
    default: ({ open, onConfirm }: any) =>
        open ? (
            <button
                type="button"
                onClick={() => onConfirm(new File(['x'], 'cropped.jpg', { type: 'image/jpeg' }))}
            >
                confirm-crop
            </button>
        ) : null,
}));

const LABELS = {
    label: 'Photo',
    add: 'Add photo',
    change: 'Change photo',
    remove: 'Remove',
    hint: 'JPG, PNG or WebP, up to 5 MB.',
    uploading: 'Uploading...',
    uploadFailed: 'The photo could not be uploaded.',
    tooLarge: 'That image is larger than 5 MB. Choose a smaller one.',
    notAnImage: 'Choose an image file.',
    cropTitle: 'Crop photo',
    cropConfirm: 'Use photo',
};

const SIGNATURE = {
    cloudName: 'erp71',
    apiKey: '123456789012345',
    timestamp: 1759999999,
    signature: 'abc123',
    folder: 'retail/tenant-1/crm-photos',
    publicIdPrefix: 'retail/tenant-1/crm-photos/',
    resourceType: 'image',
    uploadUrl: 'https://api.cloudinary.com/v1_1/erp71/image/upload',
    params: {
        allowed_formats: 'jpg,jpeg,png,webp',
        folder: 'retail/tenant-1/crm-photos',
        timestamp: '1759999999',
        transformation: 'f_auto,q_auto',
    },
    allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
    maxBytes: 5 * 1024 * 1024,
};

const mockFetch = jest.fn();
const realFetch = global.fetch;

function setup() {
    const onChange = jest.fn();
    const value: PhotoValue = { url: '', storageKey: '' };
    render(<PhotoField value={value} name="Rahim Uddin" onChange={onChange} labels={LABELS} cancelLabel="Cancel" />);
    return { onChange };
}

async function pickAndCrop() {
    const input = screen.getByTestId('photo-field-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
        value: [new File(['x'], 'rahim.jpg', { type: 'image/jpeg' })],
        configurable: true,
    });
    fireEvent.change(input);
    fireEvent.click(await screen.findByText('confirm-crop'));
}

afterAll(() => {
    global.fetch = realFetch;
});

beforeEach(() => {
    jest.clearAllMocks();
    resetDirectUploadAvailability();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockGetUploadSignature.mockResolvedValue(SIGNATURE);
    mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
            secure_url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-1/crm-photos/k3x9.jpg',
            public_id: 'retail/tenant-1/crm-photos/k3x9',
        }),
    });
    mockUploadCrmPhoto.mockResolvedValue({
        url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-1/crm-photos/via-api.jpg',
        storageKey: 'retail/tenant-1/crm-photos/via-api',
    });
});

describe('PhotoField — direct upload', () => {
    it('uploads straight to Cloudinary and reports its URL and public_id as the key', async () => {
        const { onChange } = setup();

        await pickAndCrop();

        await waitFor(() =>
            expect(onChange).toHaveBeenCalledWith({
                url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-1/crm-photos/k3x9.jpg',
                storageKey: 'retail/tenant-1/crm-photos/k3x9',
            }),
        );
        expect(mockGetUploadSignature).toHaveBeenCalledWith('crm-photo');
        expect(mockFetch.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/erp71/image/upload');
        // The base64 route is never touched when the direct one works.
        expect(mockUploadCrmPhoto).not.toHaveBeenCalled();
    });

    it('falls back to the base64 route once when Cloudinary cannot be reached', async () => {
        mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
        const { onChange } = setup();

        await pickAndCrop();

        await waitFor(() =>
            expect(onChange).toHaveBeenCalledWith({
                url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-1/crm-photos/via-api.jpg',
                storageKey: 'retail/tenant-1/crm-photos/via-api',
            }),
        );
        expect(mockUploadCrmPhoto).toHaveBeenCalledTimes(1);
        expect(mockUploadCrmPhoto).toHaveBeenCalledWith(
            expect.objectContaining({ mimeType: 'image/jpeg', fileName: 'cropped.jpg' }),
        );
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('falls back when the API will not sign', async () => {
        mockGetUploadSignature.mockRejectedValue(new Error('Not Found'));
        const { onChange } = setup();

        await pickAndCrop();

        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockUploadCrmPhoto).toHaveBeenCalledTimes(1);
    });

    it('reports the fallback’s error when both routes fail', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid Signature' } }) });
        mockUploadCrmPhoto.mockRejectedValue(new Error('storage is down'));
        const { onChange } = setup();

        await pickAndCrop();

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('storage is down'));
        expect(mockUploadCrmPhoto).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });
});
