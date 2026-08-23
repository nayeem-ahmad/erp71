import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. Do not add the dependency.
import PhotoField, { MAX_PHOTO_BYTES, type PhotoValue } from './PhotoField';

const mockUpload = jest.fn();
jest.mock('@/lib/api', () => ({
    api: { uploadCrmPhoto: (...args: any[]) => mockUpload(...args) },
}));

const mockToastError = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: { error: (...args: any[]) => mockToastError(...args) },
}));

// The real cropper pulls in react-easy-crop and a canvas. The behaviour under
// test is what PhotoField does with the cropped file, so the modal is reduced
// to a button that hands one back.
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

const EMPTY: PhotoValue = { url: '', storageKey: '' };

function setup(value: PhotoValue = EMPTY) {
    const onChange = jest.fn();
    render(
        <PhotoField
            value={value}
            name="Rahim Uddin"
            onChange={onChange}
            labels={LABELS}
            cancelLabel="Cancel"
        />,
    );
    return { onChange };
}

async function pickFile(parts: BlobPart[] = ['x'], type = 'image/jpeg') {
    const input = screen.getByTestId('photo-field-input') as HTMLInputElement;
    const file = new File(parts, 'rahim.jpg', { type });
    // fireEvent cannot populate `files` on its own, so the FileList is defined
    // on the element directly and the change event fired against it.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    // The handler reads the file asynchronously before the cropper opens.
    await waitFor(() => {});
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({
        url: 'https://cdn.example/rahim.jpg',
        storageKey: 'retail/tenant-1/crm-photos/rahim',
    });
});

describe('PhotoField', () => {
    it('shows the add action and no remove action when empty', () => {
        setup();
        expect(screen.getByRole('button', { name: /Add photo/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('offers Change rather than Add once a photo is set', () => {
        setup({ url: 'https://cdn.example/rahim.jpg', storageKey: 'k' });
        expect(screen.getByRole('button', { name: /Change photo/ })).toBeInTheDocument();
    });

    it('uploads the cropped file and reports the url and key', async () => {
        const { onChange } = setup();

        await pickFile();
        fireEvent.click(await screen.findByText('confirm-crop'));

        await waitFor(() =>
            expect(onChange).toHaveBeenCalledWith({
                url: 'https://cdn.example/rahim.jpg',
                storageKey: 'retail/tenant-1/crm-photos/rahim',
            }),
        );
        expect(mockUpload).toHaveBeenCalledWith(
            expect.objectContaining({ mimeType: 'image/jpeg', fileName: 'cropped.jpg' }),
        );
    });

    it('clears both fields when the photo is removed', async () => {
        const { onChange } = setup({
            url: 'https://cdn.example/rahim.jpg',
            storageKey: 'retail/tenant-1/crm-photos/rahim',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(onChange).toHaveBeenCalledWith({ url: '', storageKey: '' });
    });

    it('rejects a non-image before opening the cropper', async () => {
        const { onChange } = setup();

        await pickFile(['x'], 'application/pdf');

        expect(screen.queryByText('confirm-crop')).not.toBeInTheDocument();
        expect(mockToastError).toHaveBeenCalledWith(LABELS.notAnImage);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects an oversized image before opening the cropper', async () => {
        const { onChange } = setup();

        await pickFile([new Uint8Array(MAX_PHOTO_BYTES + 1)]);

        expect(screen.queryByText('confirm-crop')).not.toBeInTheDocument();
        expect(mockToastError).toHaveBeenCalledWith(LABELS.tooLarge);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('raises a toast and leaves the value alone when the upload fails', async () => {
        mockUpload.mockRejectedValue(new Error('storage is down'));
        const { onChange } = setup();

        await pickFile();
        fireEvent.click(await screen.findByText('confirm-crop'));

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('storage is down'));
        expect(onChange).not.toHaveBeenCalled();
    });
});
