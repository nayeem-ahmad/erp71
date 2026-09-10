import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorefrontImageField, {
    MAX_STOREFRONT_IMAGE_BYTES,
    type StorefrontImageFieldLabels,
} from './StorefrontImageField';

const mockUpload = jest.fn();
jest.mock('@/lib/api', () => ({
    api: { uploadStorefrontImage: (...args: any[]) => mockUpload(...args) },
}));

// The real cropper pulls in react-easy-crop and a canvas. What is under test is
// what the field does with the cropped file, so the modal is reduced to a
// button that hands one back.
jest.mock('@/components/ImageCropModal', () => ({
    __esModule: true,
    default: ({ onConfirm, title }: any) => (
        <button
            type="button"
            onClick={() => onConfirm(new File(['x'], 'cropped.jpg', { type: 'image/jpeg' }))}
        >
            confirm-crop:{title}
        </button>
    ),
}));

const LABELS: StorefrontImageFieldLabels = {
    label: 'Hero Image',
    hint: 'The wide picture behind your headline.',
    optional: 'Optional.',
    cropTitle: 'Crop hero image',
    upload: 'Upload image',
    replace: 'Replace image',
    remove: 'Remove',
    uploading: 'Uploading…',
    uploadFailed: 'The image could not be uploaded. Try again.',
    tooLarge: 'That image is larger than 5 MB. Choose a smaller one.',
    notAnImage: 'Choose a JPEG, PNG or WebP image.',
    fileHint: 'JPEG, PNG or WebP, up to 5 MB.',
    urlLabel: 'Or paste an image URL',
    urlPlaceholder: 'https://...',
    cancel: 'Cancel',
    cropConfirm: 'Use image',
    zoom: 'Zoom',
    ratioOriginal: 'Original',
    ratioSquare: 'Square',
    ratioWide: 'Wide',
};

function setup(value = '', kind: 'hero' | 'logo' = 'hero') {
    const onChange = jest.fn();
    render(
        <StorefrontImageField
            kind={kind}
            value={value}
            onChange={onChange}
            inputId="store-hero-image"
            labels={LABELS}
        />,
    );
    return { onChange };
}

async function pickFile(size = 10, type = 'image/jpeg') {
    const input = screen.getByTestId('store-hero-image-file') as HTMLInputElement;
    const file = new File([new Uint8Array(size)], 'shopfront.jpg', { type });
    // fireEvent cannot populate `files` on its own, so the FileList is defined
    // on the element directly and the change event fired against it.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {});
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({ url: 'https://cdn.example/hero.jpg' });
});

describe('StorefrontImageField', () => {
    it('uploads the cropped file and reports back its URL', async () => {
        const { onChange } = setup();

        await pickFile();
        fireEvent.click(await screen.findByText(/^confirm-crop:/));

        await waitFor(() => {
            expect(mockUpload).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'hero', fileName: 'cropped.jpg' }),
            );
        });
        expect(onChange).toHaveBeenCalledWith('https://cdn.example/hero.jpg');
    });

    it('tags the upload with the logo slot when that is the field', async () => {
        setup('', 'logo');

        await pickFile();
        fireEvent.click(await screen.findByText(/^confirm-crop:/));

        await waitFor(() => {
            expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'logo' }));
        });
    });

    it('refuses a file that is not an image, without opening the cropper', async () => {
        const { onChange } = setup();

        await pickFile(10, 'application/pdf');

        expect(screen.getByText(LABELS.notAnImage)).toBeInTheDocument();
        expect(screen.queryByText(/^confirm-crop:/)).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('refuses a file over the size ceiling', async () => {
        const { onChange } = setup();

        await pickFile(MAX_STOREFRONT_IMAGE_BYTES + 1);

        expect(screen.getByText(LABELS.tooLarge)).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('reports an upload failure beside the field rather than losing the form', async () => {
        mockUpload.mockRejectedValue(new Error('Storage is not configured.'));
        const { onChange } = setup();

        await pickFile();
        fireEvent.click(await screen.findByText(/^confirm-crop:/));

        expect(await screen.findByText('Storage is not configured.')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('clears the image when removed', () => {
        const { onChange } = setup('https://cdn.example/hero.jpg');

        fireEvent.click(screen.getByRole('button', { name: LABELS.remove }));

        expect(onChange).toHaveBeenCalledWith('');
    });

    it('still accepts a pasted URL for an image hosted elsewhere', () => {
        const { onChange } = setup();

        fireEvent.change(screen.getByLabelText(LABELS.urlLabel), {
            target: { value: 'https://elsewhere.example/banner.png' },
        });

        expect(onChange).toHaveBeenCalledWith('https://elsewhere.example/banner.png');
    });
});
