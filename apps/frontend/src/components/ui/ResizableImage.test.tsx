import type React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/**
 * The editor's content box, which the drag is clamped to.
 *
 * `.ProseMirror` rather than the node's own parent: an inline node view is
 * wrapped in a span that shrinks to fit the image, so measuring the parent
 * hands back the image's current width and it can never grow. That was a real
 * bug, invisible to a test that stubbed every element to the same width.
 */
const stubContentWidth = (px: number) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: px });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        // The wrapper hugs the image, as it does in a browser.
        get(this: HTMLElement) {
            return this.querySelector('img') ? 200 : px;
        },
    });
};

/** Renders inside a `.ProseMirror` box, the way the editor mounts it. */
const inEditor = (ui: React.ReactElement) =>
    render(<div className="ProseMirror">{ui}</div>);

/** The grip on one side. Both stay up whether or not the node is selected. */
const edgeHandle = (edge: 'start' | 'end') => {
    const handle = screen.getAllByRole('slider').find((el) => el.getAttribute('data-resize-edge') === edge);
    if (!handle) throw new Error(`no ${edge} handle`);
    return handle;
};

describe('ResizableImage', () => {
    beforeEach(() => stubContentWidth(800));

    it('shows a handle on each side even when the image is not selected', () => {
        inEditor(<ResizableImage {...props({}, jest.fn(), false)} />);
        expect(edgeHandle('start')).toBeInTheDocument();
        expect(edgeHandle('end')).toBeInTheDocument();
    });

    it('shows a handle on each side when it is selected', () => {
        inEditor(<ResizableImage {...props()} />);
        expect(screen.getAllByRole('slider')).toHaveLength(2);
    });

    it('writes the dragged width back to the node', () => {
        const updateAttributes = jest.fn();
        inEditor(<ResizableImage {...props({ width: 400 }, updateAttributes)} />);

        const handle = edgeHandle('end');
        fireEvent.pointerDown(handle, { clientX: 400 });
        fireEvent.pointerMove(window, { clientX: 300 });
        fireEvent.pointerUp(window, { clientX: 300 });

        expect(updateAttributes).toHaveBeenCalled();
        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeLessThan(400);
    });

    it('grows from the start side when the pointer moves toward the start', () => {
        const updateAttributes = jest.fn();
        inEditor(<ResizableImage {...props({ width: 400 }, updateAttributes)} />);

        const handle = edgeHandle('start');
        fireEvent.pointerDown(handle, { clientX: 200 });
        fireEvent.pointerMove(window, { clientX: 100 });
        fireEvent.pointerUp(window, { clientX: 100 });

        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeGreaterThan(400);
    });

    it('does not open the preview when a handle is clicked', () => {
        inEditor(<ResizableImage {...props()} />);

        fireEvent.click(edgeHandle('end'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('never goes below the minimum width', () => {
        const updateAttributes = jest.fn();
        inEditor(<ResizableImage {...props({ width: 100 }, updateAttributes)} />);

        const handle = edgeHandle('end');
        fireEvent.pointerDown(handle, { clientX: 100 });
        fireEvent.pointerMove(window, { clientX: -500 });
        fireEvent.pointerUp(window, { clientX: -500 });

        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeGreaterThanOrEqual(80);
    });

    it('never grows past the width of the column it sits in', () => {
        const updateAttributes = jest.fn();
        inEditor(<ResizableImage {...props({ width: 700 }, updateAttributes)} />);

        const handle = edgeHandle('end');
        fireEvent.pointerDown(handle, { clientX: 700 });
        fireEvent.pointerMove(window, { clientX: 5000 });
        fireEvent.pointerUp(window, { clientX: 5000 });

        expect(updateAttributes.mock.calls.at(-1)?.[0].width).toBeLessThanOrEqual(800);
    });

    it('offers no handle while the image is still uploading', () => {
        inEditor(<ResizableImage {...props({ src: 'blob:x', uploading: true })} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('says an upload is in flight', () => {
        inEditor(<ResizableImage {...props({ src: 'blob:x', uploading: true })} />);
        expect(screen.getByLabelText('Uploading image…')).toBeInTheDocument();
    });

    it('takes the keyboard as well as the pointer', () => {
        const updateAttributes = jest.fn();
        inEditor(<ResizableImage {...props({ width: 400 }, updateAttributes)} />);

        fireEvent.keyDown(edgeHandle('end'), { key: 'ArrowLeft' });

        expect(updateAttributes).toHaveBeenCalledWith(expect.objectContaining({ width: 380 }));
    });

    it('opens the stored file when the image is clicked', () => {
        inEditor(
            <ResizableImage
                {...props({
                    src: 'https://res.cloudinary.com/demo/image/upload/w_200,c_limit/v1/x.png?w=200',
                })}
            />,
        );

        fireEvent.click(screen.getByRole('img', { name: 'shot' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('img', { name: 'shot' })).toHaveAttribute(
            'src',
            'https://res.cloudinary.com/demo/image/upload/v1/x.png',
        );
        expect(within(dialog).getByLabelText('Zoom in')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Zoom out')).toBeInTheDocument();
    });

    it('does not open a preview while the upload is still in flight', () => {
        inEditor(<ResizableImage {...props({ src: 'blob:x', uploading: true })} />);

        fireEvent.click(screen.getByRole('img'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders the image itself', () => {
        inEditor(<ResizableImage {...props({ width: 420 })} />);
        const image = screen.getByRole('img', { name: 'shot' });
        expect(image).toHaveAttribute('src', 'https://cdn/x.png');
        expect(image).toHaveStyle({ width: '420px' });
    });
});
