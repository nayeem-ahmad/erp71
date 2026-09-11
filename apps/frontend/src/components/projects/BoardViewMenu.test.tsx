import { fireEvent, render, screen } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardViewMenu from './BoardViewMenu';
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

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

describe('BoardViewMenu', () => {
    it('keeps the panel shut until it is asked for', () => {
        render(<BoardViewMenu {...controls()} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        open();
        expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();
    });

    it('reports the setting that was picked, not the one that was showing', () => {
        const props = controls();
        render(<BoardViewMenu {...props} />);
        open();

        fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
        expect(props.set).toHaveBeenCalledWith('density', 'compact');

        fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
        expect(props.set).toHaveBeenCalledWith('columnWidth', 'wide');

        fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
        expect(props.set).toHaveBeenCalledWith('columnTint', 'none');
    });

    it('marks the current choice, so the panel reads as the board looks', () => {
        render(<BoardViewMenu {...controls({ density: 'compact' })} />);
        open();

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
        render(<BoardViewMenu {...props} />);
        open();

        fireEvent.click(screen.getByRole('switch', { name: 'Motion' }));
        expect(props.set).toHaveBeenCalledWith('animate', false);
    });

    it('toggles one card field without touching the others', () => {
        const props = controls();
        render(<BoardViewMenu {...props} />);
        open();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Labels' }));
        expect(props.toggleField).toHaveBeenCalledWith('labels');
        expect(props.toggleField).toHaveBeenCalledTimes(1);
    });

    it('offers Reset only once there is something to undo', () => {
        const { unmount } = render(<BoardViewMenu {...controls()} />);
        open();
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
        unmount();

        const props = controls({ columnWidth: 'wide' });
        render(<BoardViewMenu {...props} />);
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(props.reset).toHaveBeenCalled();
    });

    it('closes on Escape and hands focus back to the trigger', () => {
        render(<BoardViewMenu {...controls()} />);
        open();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Appearance' })).toHaveFocus();
    });

    it('closes when the pointer lands outside it', () => {
        render(
            <div>
                <BoardViewMenu {...controls()} />
                <p>the board</p>
            </div>,
        );
        open();

        fireEvent.mouseDown(screen.getByText('the board'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('BoardViewMenu on the real preference store', () => {
    // The menu and `useBoardView` wired together, which is the only place the
    // round trip through storage can be seen: the menu alone never writes, and
    // the hook alone never has a control to click.
    function Harness() {
        return <BoardViewMenu {...useBoardView()} />;
    }

    beforeEach(() => localStorage.clear());

    it('remembers a choice for the next visit', () => {
        render(<Harness />);
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Compact' }));

        expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY) ?? '{}')).toEqual({
            ...DEFAULT_BOARD_VIEW,
            density: 'compact',
        });
    });

    it('opens on what was stored last time', () => {
        localStorage.setItem(
            BOARD_VIEW_STORAGE_KEY,
            JSON.stringify({ ...DEFAULT_BOARD_VIEW, columnWidth: 'narrow' }),
        );

        render(<Harness />);
        open();
        expect(screen.getByRole('button', { name: 'Narrow' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('puts every setting back with Reset', () => {
        render(<Harness />);
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cover' }));

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY) ?? '{}')).toEqual(
            DEFAULT_BOARD_VIEW,
        );
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });
});
