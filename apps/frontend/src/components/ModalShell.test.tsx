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
