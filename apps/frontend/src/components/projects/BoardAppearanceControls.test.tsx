import { fireEvent, render, screen } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardAppearanceControls from './BoardAppearanceControls';
import { useBoardView } from './use-board-view';
import { BOARD_VIEW_STORAGE_KEY, DEFAULT_BOARD_VIEW, type BoardView } from './board-view';

const controls = (view: Partial<BoardView> = {}) => ({
    view: {
        ...DEFAULT_BOARD_VIEW,
        ...view,
        fields: { ...DEFAULT_BOARD_VIEW.fields, ...(view.fields ?? {}) },
    },
    set: jest.fn(),
    toggleField: jest.fn(),
    reset: jest.fn(),
});

/**
 * These controls used to be the body of a popover hanging off the board header
 * (`BoardViewMenu`). They are a section of the board settings panel now, so the
 * tests that were about the popover — opening it, Escape, click-outside — went
 * with it; everything here is about the controls themselves, unchanged.
 */
describe('BoardAppearanceControls', () => {
    it('reports the setting that was picked, not the one that was showing', () => {
        const props = controls();
        render(<BoardAppearanceControls {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
        expect(props.set).toHaveBeenCalledWith('density', 'compact');

        fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
        expect(props.set).toHaveBeenCalledWith('columnWidth', 'wide');

        fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
        expect(props.set).toHaveBeenCalledWith('columnTint', 'none');
    });

    it('marks the current choice, so the panel reads as the board looks', () => {
        render(<BoardAppearanceControls {...controls({ density: 'compact' })} />);

        expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('switches motion off through the switch', () => {
        const props = controls();
        render(<BoardAppearanceControls {...props} />);

        fireEvent.click(screen.getByRole('switch', { name: 'Motion' }));
        expect(props.set).toHaveBeenCalledWith('animate', false);
    });

    it('toggles one card field without touching the others', () => {
        const props = controls();
        render(<BoardAppearanceControls {...props} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Labels' }));
        expect(props.toggleField).toHaveBeenCalledWith('labels');
        expect(props.toggleField).toHaveBeenCalledTimes(1);
    });

    it('offers Reset only once there is something to undo', () => {
        const { unmount } = render(<BoardAppearanceControls {...controls()} />);
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
        unmount();

        const props = controls({ columnWidth: 'wide' });
        render(<BoardAppearanceControls {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(props.reset).toHaveBeenCalled();
    });

});

describe('BoardAppearanceControls on the real preference store', () => {
    // The controls and `useBoardView` wired together, which is the only place
    // the round trip through storage can be seen: the controls alone never
    // write, and the hook alone never has a control to click.
    function Harness() {
        return <BoardAppearanceControls {...useBoardView()} />;
    }

    beforeEach(() => localStorage.clear());

    it('remembers a choice for the next visit', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Compact' }));

        expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY) ?? '{}')).toEqual({
            ...DEFAULT_BOARD_VIEW,
            density: 'compact',
        });
    });

    it('shows what was stored last time', () => {
        localStorage.setItem(
            BOARD_VIEW_STORAGE_KEY,
            JSON.stringify({ ...DEFAULT_BOARD_VIEW, columnWidth: 'narrow' }),
        );

        render(<Harness />);
        expect(screen.getByRole('button', { name: 'Narrow' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('puts every setting back with Reset', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cover' }));

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY) ?? '{}')).toEqual(
            DEFAULT_BOARD_VIEW,
        );
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });
});
