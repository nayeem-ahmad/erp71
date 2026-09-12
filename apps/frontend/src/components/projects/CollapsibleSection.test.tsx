import { fireEvent, render, screen } from '@testing-library/react';
import CollapsibleSection from './CollapsibleSection';

describe('CollapsibleSection', () => {
    it('keeps its contents out of the document until it is opened', () => {
        render(
            <CollapsibleSection title="Attachments">
                <p>a file</p>
            </CollapsibleSection>,
        );

        expect(screen.queryByText('a file')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /attachments/i }));
        expect(screen.getByText('a file')).toBeInTheDocument();
    });

    /**
     * Unmounted rather than hidden: a closed section holding a mounted feed is
     * a closed section that still fetches.
     */
    it('unmounts its contents again when closed', () => {
        render(
            <CollapsibleSection title="Attachments" defaultOpen>
                <p>a file</p>
            </CollapsibleSection>,
        );

        fireEvent.click(screen.getByRole('button', { name: /attachments/i }));
        expect(screen.queryByText('a file')).not.toBeInTheDocument();
    });

    it('fetches once, the first time it is opened', () => {
        const onFirstOpen = jest.fn();
        render(
            <CollapsibleSection title="Activity" onFirstOpen={onFirstOpen}>
                <p>feed</p>
            </CollapsibleSection>,
        );
        const toggle = screen.getByRole('button', { name: /activity/i });

        fireEvent.click(toggle);
        fireEvent.click(toggle);
        fireEvent.click(toggle);

        expect(onFirstOpen).toHaveBeenCalledTimes(1);
    });

    it('does not fetch for a section nobody opens', () => {
        const onFirstOpen = jest.fn();
        render(
            <CollapsibleSection title="Activity" onFirstOpen={onFirstOpen}>
                <p>feed</p>
            </CollapsibleSection>,
        );

        expect(onFirstOpen).not.toHaveBeenCalled();
    });

    // A collapsed section that cannot say whether it holds anything is one
    // people open to check, which is worse than not collapsing it.
    it('says how many it holds', () => {
        render(
            <CollapsibleSection title="Attachments" count={3}>
                <p>files</p>
            </CollapsibleSection>,
        );

        expect(screen.getByRole('button', { name: /attachments 3/i })).toBeInTheDocument();
    });

    it('claims no count when it has none, and none for empty', () => {
        const { rerender } = render(
            <CollapsibleSection title="Attachments">
                <p>files</p>
            </CollapsibleSection>,
        );
        expect(screen.getByRole('button', { name: 'Attachments' })).toBeInTheDocument();

        rerender(
            <CollapsibleSection title="Attachments" count={0}>
                <p>files</p>
            </CollapsibleSection>,
        );
        expect(screen.getByRole('button', { name: 'Attachments' })).toBeInTheDocument();
    });

    it('reports its state to a screen reader', () => {
        render(
            <CollapsibleSection title="Activity">
                <p>feed</p>
            </CollapsibleSection>,
        );
        const toggle = screen.getByRole('button', { name: /activity/i });

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
});
