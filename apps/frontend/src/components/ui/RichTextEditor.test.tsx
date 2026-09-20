import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RichTextEditor } from './RichTextEditor';

/**
 * The editor is controlled, and every paste assertion is about what the value
 * becomes — so the tests drive it through a host that actually holds the state,
 * the way a description or a comment box does.
 */
function Host({
    uploadImage,
    onUploadingChange,
    initial = '',
}: {
    uploadImage?: (file: File) => Promise<{ url: string; name?: string } | null>;
    onUploadingChange?: (uploading: boolean) => void;
    initial?: string;
}) {
    const [value, setValue] = useState(initial);
    return (
        <RichTextEditor
            value={value}
            onChange={setValue}
            ariaLabel="Description"
            uploadImage={uploadImage}
            onUploadingChange={onUploadingChange}
        />
    );
}

const image = (name = 'shot.png') => new File(['binary'], name, { type: 'image/png' });

/** Pastes with the caret where a user's would be — at the end of what is there. */
const paste = (files: File[]) => {
    const box = screen.getByLabelText('Description') as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    fireEvent.paste(box, { clipboardData: { files } });
};

describe('RichTextEditor image paste', () => {
    it('inserts a placeholder and swaps it for the uploaded image', async () => {
        const uploadImage = jest.fn().mockResolvedValue({ url: 'https://cdn/x.png', name: 'x.png' });
        render(<Host uploadImage={uploadImage} initial="Steps to reproduce" />);

        paste([image()]);

        // Visible in the text straight away — a paste into the middle of a
        // paragraph has to say where the image is going.
        const box = screen.getByLabelText('Description') as HTMLTextAreaElement;
        expect(box.value).toContain('Uploading image…');

        await waitFor(() =>
            expect(box).toHaveValue('Steps to reproduce\n![x.png](https://cdn/x.png)'),
        );
        expect(uploadImage).toHaveBeenCalledTimes(1);
        expect((uploadImage.mock.calls[0][0] as File).type).toBe('image/png');
    });

    it('takes the placeholder back out when the upload is refused', async () => {
        // The caller says why — it is the one that knows the limits — so all
        // the editor owes the text is leaving nothing behind.
        render(<Host uploadImage={jest.fn().mockResolvedValue(null)} initial="Before" />);

        paste([image()]);

        await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('Before\n'));
    });

    it('takes it back out when the upload throws', async () => {
        render(<Host uploadImage={jest.fn().mockRejectedValue(new Error('offline'))} />);

        paste([image()]);

        await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue(''));
    });

    it('keeps every image of a multi-image paste', async () => {
        const uploadImage = jest
            .fn()
            .mockImplementation(async (file: File) => ({ url: `https://cdn/${file.name}` }));
        render(<Host uploadImage={uploadImage} />);

        paste([image('one.png'), image('two.png')]);

        await waitFor(() =>
            expect(screen.getByLabelText('Description')).toHaveValue(
                '![one.png](https://cdn/one.png)\n![two.png](https://cdn/two.png)',
            ),
        );
    });

    it('says when an upload is in flight and when it has landed', async () => {
        // The description saves on blur; told late, it would save the placeholder.
        const onUploadingChange = jest.fn();
        render(
            <Host
                uploadImage={jest.fn().mockResolvedValue({ url: 'https://cdn/x.png' })}
                onUploadingChange={onUploadingChange}
            />,
        );

        paste([image()]);

        await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true));
        await waitFor(() =>
            expect(onUploadingChange).toHaveBeenLastCalledWith(false),
        );
        expect(screen.getByLabelText('Description')).toHaveValue('![shot.png](https://cdn/x.png)');
    });

    it('leaves a paste carrying no image to the browser', () => {
        const uploadImage = jest.fn();
        render(<Host uploadImage={uploadImage} />);

        fireEvent.paste(screen.getByLabelText('Description'), { clipboardData: { files: [] } });

        expect(uploadImage).not.toHaveBeenCalled();
    });

    it('offers no paste hint where it cannot keep the image', () => {
        render(<Host />);
        expect(screen.queryByText(/Paste an image/)).not.toBeInTheDocument();
    });

    it('says an image can be pasted where one can', () => {
        render(<Host uploadImage={jest.fn()} />);
        expect(screen.getByText(/Paste an image to attach it\./)).toBeInTheDocument();
    });
});
