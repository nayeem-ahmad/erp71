import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See AddBoardTasksModal.test.tsx.
import BoardBackgroundPicker from './BoardBackgroundPicker';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        updateBoard: jest.fn(),
        setBoardBackgroundImage: jest.fn(),
        clearBoardBackground: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

/**
 * `FileReader` in jsdom will happily read a Blob, but asynchronously and
 * without a predictable payload, so the one call the component makes is stubbed
 * to a known data URL — what is under test is what reaches the API, not the
 * browser's base64 encoder.
 */
function stubFileReader(result: string | { fail: true }) {
    class StubReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
            setTimeout(() => {
                if (typeof result === 'string') {
                    this.result = result;
                    this.onload?.();
                } else {
                    this.onerror?.();
                }
            }, 0);
        }
    }
    (globalThis as unknown as { FileReader: unknown }).FileReader = StubReader;
}

const file = (name: string, type: string, size: number) => {
    const made = new File(['x'], name, { type });
    // `File` computes size from its parts; the picker's ceiling has to be
    // testable without allocating four megabytes.
    Object.defineProperty(made, 'size', { value: size });
    return made;
};

const plain = { background_color: null, background_image_url: null };

describe('BoardBackgroundPicker', () => {
    const realFileReader = globalThis.FileReader;

    beforeEach(() => {
        (api.updateBoard as jest.Mock).mockReset().mockResolvedValue({
            background_color: 'BLUE',
            background_image_url: null,
        });
        (api.setBoardBackgroundImage as jest.Mock).mockReset().mockResolvedValue({
            background_color: null,
            background_image_url: 'https://cdn/new.jpg',
        });
        (api.clearBoardBackground as jest.Mock).mockReset().mockResolvedValue(plain);
        (toast.success as jest.Mock).mockReset();
        (toast.error as jest.Mock).mockReset();
    });

    afterEach(() => {
        (globalThis as unknown as { FileReader: unknown }).FileReader = realFileReader;
    });

    it('saves a colour on click — there is no second step to forget', async () => {
        const onChanged = jest.fn();
        render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={onChanged}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /blue/i }));

        await waitFor(() =>
            expect(api.updateBoard).toHaveBeenCalledWith('b1', { backgroundColor: 'BLUE' }),
        );
        // The board repaints from what the API returned rather than a reload:
        // the cards have not changed and blinking every column for a colour is
        // a worse board than no colour at all.
        expect(onChanged).toHaveBeenCalledWith(
            expect.objectContaining({ background_color: 'BLUE' }),
        );
    });

    it('marks the colour the board is already wearing', () => {
        render(
            <BoardBackgroundPicker
                boardId="b1"
                background={{ background_color: 'RED', background_image_url: null }}
                onChanged={jest.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /red/i })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: /blue/i })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('uploads a picked image', async () => {
        stubFileReader('data:image/png;base64,AAAA');
        const onChanged = jest.fn();
        const { container } = render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={onChanged}
            />,
        );

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file('photo.png', 'image/png', 1024)] } });

        await waitFor(() =>
            expect(api.setBoardBackgroundImage).toHaveBeenCalledWith('b1', {
                imageBase64: 'data:image/png;base64,AAAA',
                mimeType: 'image/png',
                fileName: 'photo.png',
            }),
        );
        expect(onChanged).toHaveBeenCalledWith(
            expect.objectContaining({ background_image_url: 'https://cdn/new.jpg' }),
        );
    });

    it('refuses a file too large to survive the JSON body limit, before reading it', async () => {
        stubFileReader('data:image/png;base64,AAAA');
        const { container } = render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={jest.fn()}
            />,
        );

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, {
            target: { files: [file('huge.jpg', 'image/jpeg', 8 * 1024 * 1024)] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(api.setBoardBackgroundImage).not.toHaveBeenCalled();
    });

    it('refuses a file that is not one of the stored image types', async () => {
        stubFileReader('data:application/pdf;base64,AAAA');
        const { container } = render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={jest.fn()}
            />,
        );

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, {
            target: { files: [file('spec.pdf', 'application/pdf', 1024)] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(api.setBoardBackgroundImage).not.toHaveBeenCalled();
    });

    it('offers removal only once there is a background to remove', () => {
        const { rerender } = render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: /remove background/i })).toBeNull();

        rerender(
            <BoardBackgroundPicker
                boardId="b1"
                background={{ background_color: 'AMBER', background_image_url: null }}
                onChanged={jest.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /remove background/i })).toBeInTheDocument();
    });

    it('removes the background on request', async () => {
        const onChanged = jest.fn();
        render(
            <BoardBackgroundPicker
                boardId="b1"
                background={{ background_color: null, background_image_url: 'https://cdn/x.jpg' }}
                onChanged={onChanged}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /remove background/i }));

        await waitFor(() => expect(api.clearBoardBackground).toHaveBeenCalledWith('b1'));
        expect(onChanged).toHaveBeenCalledWith(plain);
    });

    it('reports a failure instead of claiming the board changed', async () => {
        (api.updateBoard as jest.Mock).mockRejectedValue(new Error('Board not found'));
        const onChanged = jest.fn();
        render(
            <BoardBackgroundPicker
                boardId="b1"
                background={plain}
                onChanged={onChanged}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /purple/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Board not found'));
        expect(onChanged).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows the picture the board is wearing, so a replace is an informed one', () => {
        render(
            <BoardBackgroundPicker
                boardId="b1"
                background={{ background_color: null, background_image_url: 'https://cdn/x.jpg' }}
                onChanged={jest.fn()}
            />,
        );

        expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn/x.jpg');
        expect(screen.getByRole('button', { name: /replace the picture/i })).toBeInTheDocument();
    });
});
