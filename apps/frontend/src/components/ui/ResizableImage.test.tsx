import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ResizableImage } from './ResizableImage';

/**
 * The node view is handed a ProseMirror node and a way to write back to it.
 * These tests drive it directly rather than through an editor: what is being
 * checked is the arithmetic of a drag, which an editor only obscures.
 */
const props = (
    attrs: Record<string, unknown> = {},
    updateAttributes = jest.fn(),
    selected = true,
) => ({
    node: {
        attrs: { src: 'https://cdn/x.png', alt: 'shot', width: null, uploading: false, ...attrs },
    },
    updateAttributes,
    selected,
});

/** The column the image sits in, which the drag is clamped to. */
const stubContentWidth = (px: number) => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: px });
};

describe('ResizableImage', () => {
    beforeEach(() => stubContentWidth(800));

    it('shows no handle when the image is not selected', () => {
        render(<ResizableImage {...props({}, jest.fn(), false)} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('shows a handle when it is selected', () => {
        render(<ResizableImage {...props()} />);
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('writes the dragged width back to the node', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ width: 400 }, updateAttributes)} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 400 });
        fireEvent.pointerMove(window, { clientX: 300 });
        fireEvent.pointerUp(window, { clientX: 300 });

        expect(updateAttributes).toHaveBeenCalled();
        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeLessThan(400);
    });

    it('never goes below the minimum width', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ width: 100 }, updateAttributes)} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 100 });
        fireEvent.pointerMove(window, { clientX: -500 });
        fireEvent.pointerUp(window, { clientX: -500 });

        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeGreaterThanOrEqual(80);
    });

    it('never grows past the width of the column it sits in', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ width: 700 }, updateAttributes)} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 700 });
        fireEvent.pointerMove(window, { clientX: 5000 });
        fireEvent.pointerUp(window, { clientX: 5000 });

        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeLessThanOrEqual(800);
    });

    it('offers no handle while the image is still uploading', () => {
        render(<ResizableImage {...props({ src: 'blob:x', uploading: true })} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('says an upload is in flight', () => {
        render(<ResizableImage {...props({ src: 'blob:x', uploading: true })} />);
        expect(screen.getByLabelText('Uploading image…')).toBeInTheDocument();
    });

    it('takes the keyboard as well as the pointer', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ width: 400 }, updateAttributes)} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });

        expect(updateAttributes).toHaveBeenCalledWith(expect.objectContaining({ width: 380 }));
    });

    it('renders the image itself', () => {
        render(<ResizableImage {...props({ width: 420 })} />);
        const image = screen.getByRole('img', { name: 'shot' });
        expect(image).toHaveAttribute('src', 'https://cdn/x.png');
        expect(image).toHaveStyle({ width: '420px' });
    });
});
