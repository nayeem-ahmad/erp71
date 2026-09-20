import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ModalShell, { ModalHeader, ModalFooter } from './ModalShell';

describe('ModalShell', () => {
    it('renders children', () => {
        render(
            <ModalShell>
                <div>content</div>
            </ModalShell>
        );
        expect(screen.getByText('content')).toBeInTheDocument();
    });

    it('applies the mobile bottom-sheet backdrop classes (items-end -> sm:items-center)', () => {
        render(
            <ModalShell>
                <div>content</div>
            </ModalShell>
        );
        const backdrop = screen.getByRole('presentation');
        expect(backdrop.className).toContain('items-end');
        expect(backdrop.className).toContain('sm:items-center');
        expect(backdrop.className).toContain('z-modal');
    });

    it('applies the updated panel radius and shadow', () => {
        render(
            <ModalShell>
                <div>content</div>
            </ModalShell>
        );
        const panel = screen.getByRole('dialog');
        expect(panel.className).toContain('rounded-t-xl');
        expect(panel.className).toContain('sm:rounded-xl');
        expect(panel.className).toContain('shadow-2xl');
        expect(panel.className).not.toContain('rounded-3xl');
    });

    it('calls onBackdropClick when the backdrop is clicked, not when the panel is clicked', () => {
        const onBackdropClick = jest.fn();
        render(
            <ModalShell onBackdropClick={onBackdropClick}>
                <div>content</div>
            </ModalShell>
        );
        fireEvent.click(screen.getByRole('dialog'));
        expect(onBackdropClick).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('presentation'));
        expect(onBackdropClick).toHaveBeenCalledTimes(1);
    });

    it('calls onBackdropClick when Escape is pressed', () => {
        const onBackdropClick = jest.fn();
        render(
            <ModalShell onBackdropClick={onBackdropClick}>
                <div>content</div>
            </ModalShell>
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onBackdropClick).toHaveBeenCalledTimes(1);
    });

    it('does not error on Escape when onBackdropClick is not provided', () => {
        render(
            <ModalShell>
                <div>content</div>
            </ModalShell>
        );
        expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    });

    /**
     * The drawer variant, added for the activities list's per-lead timeline.
     * Below `sm` it is deliberately the same bottom sheet as every other modal.
     */
    it('anchors the drawer to the inline edge above sm and stays a bottom sheet below it', () => {
        render(
            <ModalShell variant="drawer">
                <div>content</div>
            </ModalShell>
        );
        const backdrop = screen.getByRole('presentation');
        expect(backdrop.className).toContain('items-end');
        expect(backdrop.className).toContain('sm:justify-end');
        expect(backdrop.className).not.toContain('sm:items-center');

        const panel = screen.getByRole('dialog');
        expect(panel.className).toContain('rounded-t-xl');
        expect(panel.className).toContain('sm:h-full');
        // Logical, so the rounded side faces the page in Arabic and Urdu too.
        expect(panel.className).toContain('sm:rounded-s-xl');
    });

    /**
     * `translateX` is physical (docs/rtl-guidelines.md), so an RTL locale needs
     * the offset negated or the drawer flies in from the edge it is not on.
     */
    it('flips the drawer\'s entry offset under RTL', () => {
        render(
            <ModalShell variant="drawer">
                <div>content</div>
            </ModalShell>
        );
        const panel = screen.getByRole('dialog');
        expect(panel.className).toContain('sm:motion-safe:animate-drawer-in');
        expect(panel.className).toContain('rtl:[--drawer-from:-100%]');
    });

    /**
     * The activities drawer holds a panel with its own edit and complete
     * dialogs. Both shells listen on `document`, so without the open-shell
     * stack one Escape would close the dialog and the drawer behind it.
     */
    it('closes only the innermost shell on Escape, and hands it back once that one is gone', () => {
        const outer = jest.fn();
        const inner = jest.fn();
        const Nested = ({ showInner }: { showInner: boolean }) => (
            <ModalShell onBackdropClick={outer}>
                <div>outer content</div>
                {showInner && (
                    <ModalShell onBackdropClick={inner}>
                        <div>inner content</div>
                    </ModalShell>
                )}
            </ModalShell>
        );

        const { rerender } = render(<Nested showInner />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();

        rerender(<Nested showInner={false} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).toHaveBeenCalledTimes(1);
    });

    /**
     * Two full backdrops stacked put the page at 75% black and blur the blur —
     * what the panel's edit dialog over the activities drawer looked like
     * before the inner shell learned it was an inner shell.
     */
    it('scrims lightly when it opens on top of another shell', () => {
        render(
            <ModalShell onBackdropClick={() => {}}>
                <div>outer content</div>
                <ModalShell onBackdropClick={() => {}}>
                    <div>inner content</div>
                </ModalShell>
            </ModalShell>
        );
        const [outer, inner] = screen.getAllByRole('presentation');
        expect(outer.className).toContain('bg-black/50');
        expect(outer.className).toContain('backdrop-blur-sm');
        expect(inner.className).toContain('bg-black/20');
        expect(inner.className).not.toContain('backdrop-blur-sm');
    });

    it('applies size classes and merges custom className', () => {
        render(
            <ModalShell size="lg" className="my-extra-class">
                <div>content</div>
            </ModalShell>
        );
        const panel = screen.getByRole('dialog');
        expect(panel.className).toContain('sm:max-w-3xl');
        expect(panel.className).toContain('my-extra-class');
    });
});

describe('ModalHeader (opt-in)', () => {
    it('renders a title and a close button with an aria-label', () => {
        const onClose = jest.fn();
        render(<ModalHeader title="My Modal" onClose={onClose} />);
        expect(screen.getByText('My Modal')).toBeInTheDocument();
        const closeButton = screen.getByRole('button', { name: /close/i });
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders optional subtitle and extra children', () => {
        render(
            <ModalHeader title="Title" subtitle="Subtitle text" onClose={() => {}}>
                <span>extra</span>
            </ModalHeader>
        );
        expect(screen.getByText('Subtitle text')).toBeInTheDocument();
        expect(screen.getByText('extra')).toBeInTheDocument();
    });
});

describe('ModalFooter (opt-in)', () => {
    it('renders children right-aligned', () => {
        render(
            <ModalFooter>
                <button>Cancel</button>
                <button>Save</button>
            </ModalFooter>
        );
        expect(screen.getByText('Cancel')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
    });
});
