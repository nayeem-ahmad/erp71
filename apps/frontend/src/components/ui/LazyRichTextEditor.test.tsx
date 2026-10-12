import { render, screen } from '@testing-library/react';

// jest.setup swaps this module for the real editor so other suites need not
// wait on the chunk; this suite is about the swap itself.
jest.unmock('@/components/ui/LazyRichTextEditor');

import { RichTextEditor } from './LazyRichTextEditor';

const noop = () => undefined;

function placeholderIn(container: HTMLElement) {
    return container.querySelector('[data-rich-text-editor-placeholder]');
}

describe('LazyRichTextEditor', () => {
    /*
     * One test, not three: the chunk loads once per module, and the moment it
     * has, every later render is the editor itself. Every placeholder check
     * runs synchronously, before the import can settle.
     */
    it('holds the editor\'s place at the editor\'s size, then draws the editor', async () => {
        const description = render(
            <RichTextEditor value="Hello" onChange={noop} ariaLabel="Description" rows={10} hideHint />,
        ).container;
        const comment = render(<RichTextEditor value="" onChange={noop} rows={1} hideHint showActions />).container;

        // Sized from `rows` by the editor's own arithmetic, so nothing jumps.
        const box = (container: HTMLElement) => placeholderIn(container)!.querySelector('.border > div') as HTMLElement;
        expect(box(description).style.minHeight).toBe('15rem');
        expect(box(comment).style.minHeight).toBe('3rem');

        // The footer line only where the editor will have something to put in it.
        const hasFooter = (container: HTMLElement) =>
            Array.from(placeholderIn(container)!.children).some((child) => child.classList.contains('h-4'));
        expect(hasFooter(description)).toBe(false);
        expect(hasFooter(comment)).toBe(true);

        expect(await screen.findByLabelText('Description', {}, { timeout: 10000 })).toHaveTextContent('Hello');
        expect(placeholderIn(description)).not.toBeInTheDocument();
        expect(description.querySelector('[data-rich-text-editor]')).toBeInTheDocument();
    }, 15000);
});
