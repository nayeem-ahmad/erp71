import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    onImageDiscarded,
    onUploadingChange,
    initial = '',
    onSubmit,
    onCancel,
    showActions,
}: {
    uploadImage?: (file: File) => Promise<{ url: string; name?: string; id?: string } | null>;
    onImageDiscarded?: (image: { url: string; name?: string; id?: string }) => void;
    onUploadingChange?: (uploading: boolean) => void;
    initial?: string;
    /** Told the value as the host holds it when the save happens. */
    onSubmit?: (value: string) => void;
    onCancel?: () => void;
    showActions?: boolean;
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
            onImageDiscarded={onImageDiscarded}
            onUploadingChange={onUploadingChange}
            // A closure over this render's value, the way every real caller's
            // save is: the description's `commit`, the comment box's `post`.
            onSubmit={onSubmit ? () => onSubmit(value) : undefined}
            onCancel={onCancel}
            showActions={showActions}
        />
    );
}

const image = (name = 'shot.png') => new File(['binary'], name, { type: 'image/png' });

const surface = () => screen.getByLabelText('Description');

const paste = (files: File[]) => {
    fireEvent.paste(surface(), { clipboardData: { files, getData: () => '' } });
};

const shot = (bytes: string) => new File([bytes], 'image.png', { type: 'image/png' });

/**
 * A paste whose clipboard answers with `current` until something reads
 * `getData`, and with `previous` afterwards — Chrome once ProseMirror has
 * looked at the HTML on the clipboard.
 */
const pasteScreenshot = async (target: HTMLElement, current: File, previous: File | null) => {
    let stale = false;
    const choose = () => (stale && previous ? previous : current);
    const clipboardData = {
        getData: () => {
            stale = true;
            return '';
        },
        types: ['Files'],
        get items() {
            const file = choose();
            return [{ kind: 'file', type: 'image/png', getAsFile: () => file }];
        },
        get files() {
            return [choose()];
        },
    };
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    // The upload resolves on a microtask. Flush it here, or the swap of the
    // blob URL for the stored one updates state outside the test's act.
    await act(async () => {
        target.dispatchEvent(event);
    });
};

/**
 * Replaces what the editor holds with `text`, through ProseMirror's own paste
 * handling — the one path in jsdom that produces a real document.
 */
const typeText = (text: string) => {
    fireEvent.focus(surface());
    fireEvent.keyDown(surface(), { key: 'a', ctrlKey: true });
    fireEvent.paste(surface(), {
        clipboardData: {
            files: [],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
            types: ['text/plain'],
        },
    });
};

/** Ctrl+Enter; `Mod` is Ctrl off a Mac, and jsdom is not one. */
const pressModEnter = () => fireEvent.keyDown(surface(), { key: 'Enter', ctrlKey: true });

/** An upload that stays in flight until the test lets it land. */
const heldUpload = () => {
    let land!: (value: { url: string; name?: string; id?: string }) => void;
    const uploadImage = jest.fn().mockReturnValue(
        new Promise((resolve) => {
            land = resolve as (value: { url: string; name?: string; id?: string }) => void;
        }),
    );
    return { uploadImage, land: (value: { url: string }) => land(value) };
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

    /**
     * Chrome on Windows keeps the previous screenshot on the clipboard once
     * something reads `getData` — which ProseMirror does, for the HTML, before
     * it asks the editor what to do with the paste. Two screenshots in a row
     * were coming back as the first one, in the description and in Attachments.
     */
    it('uploads each pasted screenshot, not the previous one', async () => {
        const uploadImage = jest.fn(async (file: File) => {
            const bytes = await file.text();
            return { url: `https://cdn/${bytes}.png`, name: `${bytes}.png` };
        });
        render(<Host uploadImage={uploadImage} />);

        await pasteScreenshot(surface(), shot('one'), null);
        await pasteScreenshot(surface(), shot('two'), shot('one'));

        await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
        expect(await (uploadImage.mock.calls[0][0] as File).text()).toBe('one');
        expect(await (uploadImage.mock.calls[1][0] as File).text()).toBe('two');
        await waitFor(() => {
            expect(latest).toContain('https://cdn/one.png');
            expect(latest).toContain('https://cdn/two.png');
        });
    });

    it('renames a clipboard screenshot so it is not another image.png', async () => {
        const uploadImage = jest.fn().mockResolvedValue({ url: 'https://cdn/a.png', name: 'kept.png' });
        render(<Host uploadImage={uploadImage} />);

        paste([image('image.png'), image('image.png')]);

        await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
        const names = uploadImage.mock.calls.map((call) => (call[0] as File).name);
        expect(names[0]).toMatch(/^image-[a-z0-9]+\.png$/);
        expect(names[1]).toMatch(/^image-[a-z0-9]+\.png$/);
        expect(names[0]).not.toBe(names[1]);
        expect(names).not.toContain('image.png');
    });

    it('opens a full-size preview when the pasted image is clicked', async () => {
        const { uploadImage, land } = heldUpload();
        render(<Host uploadImage={uploadImage} initial="Before" />);

        paste([image()]);
        await screen.findByRole('img');
        await act(async () => {
            land({
                url: 'https://res.cloudinary.com/demo/image/upload/w_80,c_limit/v1/shot.png?w=80',
                name: 'shot.png',
            });
        });

        fireEvent.click(await screen.findByRole('img', { name: 'shot.png' }));

        expect(within(screen.getByRole('dialog')).getByRole('img', { name: 'shot.png' })).toHaveAttribute(
            'src',
            'https://res.cloudinary.com/demo/image/upload/v1/shot.png',
        );
        expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument();
    });

    it('inserts an image chosen from the toolbar', async () => {
        const uploadImage = jest.fn().mockResolvedValue({ url: 'https://cdn/picked.png', name: 'picked.png' });
        render(<Host uploadImage={uploadImage} />);

        const input = document.querySelector('[data-rich-text-editor] input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [image('picked.png')] } });

        await waitFor(() => expect(latest).toBe('![picked.png](https://cdn/picked.png)'));
        expect(uploadImage).toHaveBeenCalledTimes(1);
    });

    it('tells the caller when the image was removed before the upload landed', async () => {
        const { uploadImage, land } = heldUpload();
        const onImageDiscarded = jest.fn();
        render(<Host uploadImage={uploadImage} onImageDiscarded={onImageDiscarded} />);

        paste([image()]);
        await screen.findByRole('img');
        fireEvent.focus(surface());
        fireEvent.keyDown(surface(), { key: 'a', ctrlKey: true });
        fireEvent.keyDown(surface(), { key: 'Backspace' });

        await act(async () => {
            land({ url: 'https://cdn/x.png', id: 'a1', name: 'shot.png' });
        });

        await waitFor(() =>
            expect(onImageDiscarded).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'https://cdn/x.png', id: 'a1' }),
            ),
        );
    });
});

describe('RichTextEditor spelling suggestions', () => {
    /** The word the suggestion replaces, the way Chrome reports it. */
    const targetRange = (root: HTMLElement, word: string) => {
        const text = root.querySelector('p')?.firstChild;
        if (!text) throw new Error('no text');
        const start = text.textContent?.indexOf(word) ?? -1;
        return new StaticRange({
            startContainer: text,
            startOffset: start,
            endContainer: text,
            endOffset: start + word.length,
        });
    };

    const suggest = async (root: HTMLElement, word: string, replacement: string, via: 'data' | 'transfer') => {
        const event = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertReplacementText',
            data: via === 'data' ? replacement : '',
        });
        if (via === 'transfer') {
            // jsdom has no DataTransfer constructor. The event only needs getData.
            const transfer = {
                getData: (type: string) => (type === 'text/plain' || type === 'text' ? replacement : ''),
            };
            Object.defineProperty(event, 'dataTransfer', { value: transfer });
        }
        Object.defineProperty(event, 'getTargetRanges', {
            value: () => [targetRange(root, word)],
        });
        await act(async () => {
            root.dispatchEvent(event);
        });
    };

    it('replaces the misspelled word from insertReplacementText', async () => {
        render(<Host initial="teh cat" />);
        const root = surface();
        await waitFor(() => expect(root.textContent).toContain('teh'));
        expect(root).toHaveAttribute('spellcheck', 'true');

        await suggest(root, 'teh', 'the', 'data');

        await waitFor(() => expect(latest).toBe('the cat'));
    });

    it('reads the suggestion from dataTransfer when data is empty', async () => {
        // A contenteditable reports the word on the transfer, not on `data`.
        render(<Host initial="teh cat" />);
        const root = surface();
        await waitFor(() => expect(root.textContent).toContain('teh'));

        await suggest(root, 'teh', 'the', 'transfer');

        await waitFor(() => expect(latest).toBe('the cat'));
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

describe('RichTextEditor saving with Ctrl/⌘+Enter', () => {
    /*
     * TipTap builds the editor's extensions once and never rebuilds them, so a
     * shortcut holding the caller's callback kept the one from the render the
     * editor opened in — and with it the text as it was then. The description
     * closed without saving what was typed, and the comment box posted nothing.
     */
    it('saves the text as it is now, not as it was when the editor opened', async () => {
        const onSubmit = jest.fn();
        render(<Host initial="Draft" onSubmit={onSubmit} />);

        typeText('Revised');
        await waitFor(() => expect(latest).toBe('Revised'));
        pressModEnter();

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith('Revised');
    });

    it('does not save while a pasted image is still uploading', async () => {
        // The text holds a blob URL until the upload lands, and a blob URL
        // means nothing outside the tab that made it.
        const { uploadImage } = heldUpload();
        const onSubmit = jest.fn();
        render(<Host initial="See below" onSubmit={onSubmit} uploadImage={uploadImage} />);

        paste([image()]);
        await screen.findByRole('img');
        pressModEnter();

        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe('RichTextEditor save and cancel buttons', () => {
    it('draws none unless asked to', () => {
        // The comment box has its own Comment button; a form has its footer.
        render(<Host onSubmit={jest.fn()} onCancel={jest.fn()} />);

        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('saves what was typed through the tick', async () => {
        const onSubmit = jest.fn();
        const onCancel = jest.fn();
        render(<Host showActions onSubmit={onSubmit} onCancel={onCancel} />);

        typeText('Revised');
        await waitFor(() => expect(latest).toBe('Revised'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith('Revised');
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancels through the cross, without saving', () => {
        const onSubmit = jest.fn();
        const onCancel = jest.fn();
        render(<Host showActions onSubmit={onSubmit} onCancel={onCancel} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('holds the tick back until a pasted image has landed', async () => {
        const { uploadImage, land } = heldUpload();
        render(
            <Host showActions onSubmit={jest.fn()} onCancel={jest.fn()} uploadImage={uploadImage} />,
        );

        paste([image()]);
        await screen.findByRole('img');
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        await act(async () => {
            land({ url: 'https://cdn/x.png' });
        });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    });
});
