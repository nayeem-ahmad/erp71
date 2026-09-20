import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ImagePreviewModal, type PreviewItem } from './ImagePreviewModal';

const items: PreviewItem[] = [
    { url: 'https://cdn/one.png', name: 'one.png', mimeType: 'image/png' },
    { url: 'https://cdn/two.pdf', name: 'two.pdf', mimeType: 'application/pdf' },
    { url: 'https://cdn/three.png', name: 'three.png', mimeType: 'image/png' },
];

const open = (index = 0, onIndexChange = jest.fn(), onClose = jest.fn()) => {
    render(
        <ImagePreviewModal
            items={items}
            index={index}
            onIndexChange={onIndexChange}
            onClose={onClose}
        />,
    );
    return { onIndexChange, onClose };
};

/** Fitted, before anyone has zoomed. */
const FIT = 'scale(1) translate(0px, 0px)';

describe('ImagePreviewModal', () => {
    it('shows the image at the given index', () => {
        open(0);
        expect(screen.getByRole('img', { name: 'one.png' })).toHaveAttribute(
            'src',
            'https://cdn/one.png',
        );
    });

    it('renders a PDF inline rather than as an image', () => {
        // The point of the modal: a PDF used to mean a trip to another tab.
        open(1);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByTitle('two.pdf')).toHaveAttribute('src', 'https://cdn/two.pdf');
    });

    it('steps to the next item', () => {
        const { onIndexChange } = open(0);
        fireEvent.click(screen.getByLabelText('Next'));
        expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('steps to the previous item', () => {
        const { onIndexChange } = open(1);
        fireEvent.click(screen.getByLabelText('Previous'));
        expect(onIndexChange).toHaveBeenCalledWith(0);
    });

    it('wraps around at the end', () => {
        const { onIndexChange } = open(2);
        fireEvent.click(screen.getByLabelText('Next'));
        expect(onIndexChange).toHaveBeenCalledWith(0);
    });

    it('wraps around at the start', () => {
        const { onIndexChange } = open(0);
        fireEvent.click(screen.getByLabelText('Previous'));
        expect(onIndexChange).toHaveBeenCalledWith(2);
    });

    it('steps with the arrow keys', () => {
        const { onIndexChange } = open(0);
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('offers no paging for a single item', () => {
        render(
            <ImagePreviewModal
                items={[items[0]]}
                index={0}
                onIndexChange={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(screen.queryByLabelText('Next')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Previous')).not.toBeInTheDocument();
    });

    it('zooms in and back to fit', () => {
        open(0);
        const image = screen.getByRole('img', { name: 'one.png' });
        expect(image).toHaveStyle({ transform: FIT });

        fireEvent.click(screen.getByLabelText('Zoom in'));
        expect(image).not.toHaveStyle({ transform: FIT });

        fireEvent.click(screen.getByLabelText('Reset zoom'));
        expect(image).toHaveStyle({ transform: FIT });
    });

    it('zooms with the wheel', () => {
        open(0);
        fireEvent.wheel(screen.getByTestId('preview-stage'), { deltaY: -100 });
        expect(screen.getByRole('img', { name: 'one.png' })).not.toHaveStyle({ transform: FIT });
    });

    it('pans only once zoomed in', () => {
        open(0);
        const stage = screen.getByTestId('preview-stage');
        const image = screen.getByRole('img', { name: 'one.png' });

        // Fitted, a drag would only slide the picture off its own frame.
        fireEvent.pointerDown(stage, { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(stage, { clientX: 50, clientY: 10 });
        expect(image).toHaveStyle({ transform: FIT });
        fireEvent.pointerUp(stage);

        fireEvent.click(screen.getByLabelText('Zoom in'));
        fireEvent.pointerDown(stage, { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(stage, { clientX: 50, clientY: 10 });
        expect(image.style.transform).toContain('translate(50px, 10px)');
    });

    it('resets the zoom when the item changes', () => {
        const { rerender } = render(
            <ImagePreviewModal
                items={items}
                index={0}
                onIndexChange={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        fireEvent.click(screen.getByLabelText('Zoom in'));

        rerender(
            <ImagePreviewModal
                items={items}
                index={2}
                onIndexChange={jest.fn()}
                onClose={jest.fn()}
            />,
        );

        expect(screen.getByRole('img', { name: 'three.png' })).toHaveStyle({ transform: FIT });
    });

    it('offers a download and a way out to the raw file', () => {
        open(0);
        const download = screen.getByLabelText('Download');
        expect(download).toHaveAttribute('href', 'https://cdn/one.png');
        expect(download).toHaveAttribute('download', 'one.png');
        expect(screen.getByLabelText('Open in a new tab')).toHaveAttribute('target', '_blank');
    });

    it('closes', () => {
        const { onClose } = open(0);
        fireEvent.click(screen.getByLabelText('Close preview'));
        expect(onClose).toHaveBeenCalled();
    });

    it('says when a file cannot be previewed, and still offers it', () => {
        render(
            <ImagePreviewModal
                items={[{ url: 'https://cdn/notes.docx', name: 'notes.docx', mimeType: 'application/msword' }]}
                index={0}
                onIndexChange={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(screen.getByText('This file cannot be previewed.')).toBeInTheDocument();
        expect(screen.getByLabelText('Download')).toHaveAttribute('href', 'https://cdn/notes.docx');
    });

    it('shows nothing when there is nothing to show', () => {
        const { container } = render(
            <ImagePreviewModal items={[]} index={0} onIndexChange={jest.fn()} onClose={jest.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing when the index is out of range', () => {
        const { container } = render(
            <ImagePreviewModal
                items={items}
                index={9}
                onIndexChange={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
