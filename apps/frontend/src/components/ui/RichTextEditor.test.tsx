import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RichTextEditor } from './RichTextEditor';

/**
 * The editor is controlled and its value is markdown, so every assertion here
 * is about what the value becomes — driven through a host that actually holds
 * the state, the way a description or a comment box does.
 *
 * It used to be a textarea and these tests read `textarea.value`. The surface
 * changed; the behaviours did not, and each one below was a real bug once.
 */
let latest = '';

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
    latest = value;
    return (
        <RichTextEditor
            value={value}
            onChange={(next) => {
                latest = next;
                setValue(next);
            }}
            ariaLabel="Description"
            uploadImage={uploadImage}
            onUploadingChange={onUploadingChange}
        />
    );
}

const image = (name = 'shot.png') => new File(['binary'], name, { type: 'image/png' });

const surface = () => screen.getByLabelText('Description');

const paste = (files: File[]) => {
    fireEvent.paste(surface(), { clipboardData: { files, getData: () => '' } });
};

beforeAll(() => {
    // jsdom has no object URLs, and the local preview is built on them.
    let n = 0;
    global.URL.createObjectURL = jest.fn(() => `blob:jsdom/${(n += 1)}`);
    global.URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
    latest = '';
});

describe('RichTextEditor image paste', () => {
    it('shows the image straight away and swaps it for the uploaded one', async () => {
        // Held open, because that is what an upload is: the local preview
        // only earns its keep if it is on screen while the bytes are in
        // flight, and a promise that has already resolved cannot show that.
        let settle!: (v: { url: string; name: string }) => void;
        const uploadImage = jest.fn().mockReturnValue(
            new Promise((resolve) => {
                settle = resolve as (v: { url: string; name: string }) => void;
            }),
        );
        render(<Host uploadImage={uploadImage} initial="Steps to reproduce" />);

        paste([image()]);

        const shown = await screen.findByRole('img');
        expect(shown).toHaveAttribute('src', expect.stringContaining('blob:'));
        expect(shown.closest('[data-uploading]')).toHaveAttribute('data-uploading', 'true');

        await act(async () => {
            settle({ url: 'https://cdn/x.png', name: 'x.png' });
        });

        await waitFor(() =>
            expect(latest).toBe('Steps to reproduce\n\n![x.png](https://cdn/x.png)'),
        );
        expect(uploadImage).toHaveBeenCalledTimes(1);
        expect((uploadImage.mock.calls[0][0] as File).type).toBe('image/png');
    });

    it('never reports a blob URL as the value', async () => {
        // The description saves on blur. A blob URL in the database is a dead
        // link the moment the tab closes.
        const reported: string[] = [];
        let settle!: (v: { url: string }) => void;
        const uploadImage = jest.fn().mockReturnValue(
            new Promise((resolve) => {
                settle = resolve as (v: { url: string }) => void;
            }),
        );

        function Watching() {
            const [value, setValue] = useState('');
            reported.push(value);
            return (
                <RichTextEditor
                    value={value}
                    onChange={setValue}
                    ariaLabel="Description"
                    uploadImage={uploadImage}
                />
            );
        }
        render(<Watching />);

        paste([image()]);
        await screen.findByRole('img');
        await act(async () => {
            settle({ url: 'https://cdn/x.png' });
        });

        await waitFor(() => expect(reported.at(-1)).toContain('https://cdn/x.png'));
        expect(reported.some((value) => value.includes('blob:'))).toBe(false);
    });

    it('takes the image back out when the upload is refused', async () => {
        // The caller says why — it is the one that knows the limits — so all
        // the editor owes the text is leaving nothing behind.
        render(<Host uploadImage={jest.fn().mockResolvedValue(null)} initial="Before" />);

        paste([image()]);

        await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
        expect(latest).toBe('Before');
    });

    it('takes it back out when the upload throws', async () => {
        render(<Host uploadImage={jest.fn().mockRejectedValue(new Error('offline'))} />);

        paste([image()]);

        await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
        expect(latest).toBe('');
    });

    it('keeps every image of a multi-image paste', async () => {
        // Two uploads landing back to back used to race: both read the text
        // before React had painted the first one's edit.
        const uploadImage = jest
            .fn()
            .mockImplementation(async (file: File) => ({ url: `https://cdn/${file.name}` }));
        render(<Host uploadImage={uploadImage} />);

        paste([image('one.png'), image('two.png')]);

        await waitFor(() => {
            expect(latest).toContain('https://cdn/one.png');
            expect(latest).toContain('https://cdn/two.png');
        });
    });

    it('says when an upload is in flight and when it has landed', async () => {
        const onUploadingChange = jest.fn();
        render(
            <Host
                uploadImage={jest.fn().mockResolvedValue({ url: 'https://cdn/x.png' })}
                onUploadingChange={onUploadingChange}
            />,
        );

        paste([image()]);

        await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true));
        await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
        // Told only once the real URL is in the value, never before.
        expect(latest).toBe('![shot.png](https://cdn/x.png)');
    });

    it('leaves a paste carrying no image to the browser', () => {
        const uploadImage = jest.fn();
        render(<Host uploadImage={uploadImage} />);

        fireEvent.paste(surface(), { clipboardData: { files: [], getData: () => 'hello' } });

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

describe('RichTextEditor markdown contract', () => {
    it('renders the markdown it is given', async () => {
        render(<Host initial="A **bold** word." />);
        await waitFor(() => expect(screen.getByText('bold').tagName).toBe('STRONG'));
    });

    it('shows an image the value already holds', async () => {
        render(<Host initial="![shot.png](https://cdn/shot.png)" />);
        expect(await screen.findByRole('img')).toHaveAttribute('src', 'https://cdn/shot.png');
    });

    it('sizes an image to the width on its URL', async () => {
        render(<Host initial="![shot.png](https://cdn/shot.png?w=420)" />);
        expect(await screen.findByRole('img')).toHaveStyle({ width: '420px' });
    });
});
