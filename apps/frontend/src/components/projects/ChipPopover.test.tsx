import { fireEvent, render, screen } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house
// pattern is fireEvent from @testing-library/react.
import ChipPopover, { type ChipOption } from './ChipPopover';

const roster: ChipOption[] = [
    { value: 'user:u1', label: 'Karim', subtitle: 'karim@x.com' },
    { value: 'user:u2', label: 'Shamim Rahman', subtitle: 'shamim@x.com' },
    { value: 'employee:e1', label: 'Rahim Uddin' },
];

const chip = (props: Partial<Parameters<typeof ChipPopover>[0]> = {}) => {
    const onPick = jest.fn();
    render(
        <ChipPopover
            label="Assignee"
            value=""
            display="Unassigned"
            options={roster}
            onPick={onPick}
            emptyLabel="Unassigned"
            filterable
            {...props}
        />,
    );
    return onPick;
};

const trigger = () => screen.getByRole('button', { name: 'Assignee' });

describe('ChipPopover', () => {
    it('reads its value on the chip, closed', () => {
        chip({ value: 'user:u1', display: 'Karim' });

        expect(trigger()).toHaveTextContent('Karim');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('opens on click and lists the options', () => {
        chip();
        fireEvent.click(trigger());

        expect(screen.getByRole('listbox', { name: 'Assignee' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Karim/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Rahim Uddin/ })).toBeInTheDocument();
    });

    it('tells the owner to load its list the first time it opens', () => {
        const onOpen = jest.fn();
        chip({ onOpen });

        fireEvent.click(trigger());
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('picks by click, and reports the value', () => {
        const onPick = chip();
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: /Shamim Rahman/ }));

        expect(onPick).toHaveBeenCalledWith('user:u2');
        // Closes behind the pick — a popover that stays open reads as unsaved.
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('clears through the empty row, as the empty string', () => {
        const onPick = chip({ value: 'user:u1', display: 'Karim' });
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'Unassigned' }));

        // '' not undefined: PATCH reads undefined as "leave alone", so only the
        // empty string can mean nobody.
        expect(onPick).toHaveBeenCalledWith('');
    });

    it('does not write when the pick is what was already set', () => {
        const onPick = chip({ value: 'user:u1', display: 'Karim' });
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: /Karim/ }));

        expect(onPick).not.toHaveBeenCalled();
    });

    it('filters by label and by subtitle', () => {
        chip();
        fireEvent.click(trigger());

        const box = screen.getByLabelText('Search');
        fireEvent.change(box, { target: { value: 'shamim' } });
        expect(screen.getByRole('option', { name: /Shamim Rahman/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Rahim Uddin/ })).not.toBeInTheDocument();

        // The subtitle is searched too, so an email finds its person.
        fireEvent.change(box, { target: { value: 'karim@' } });
        expect(screen.getByRole('option', { name: /Karim/ })).toBeInTheDocument();
    });

    it('keeps the clear row reachable while a search narrows everything else', () => {
        chip({ value: 'user:u1', display: 'Karim' });
        fireEvent.click(trigger());
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzzz' } });

        expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    });

    it('moves with the arrow keys and picks with Enter', () => {
        const onPick = chip({ emptyLabel: undefined });
        fireEvent.click(trigger());

        const box = screen.getByLabelText('Search');
        fireEvent.keyDown(box, { key: 'ArrowDown' });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect(onPick).toHaveBeenCalledWith('user:u2');
    });

    it('wraps around the ends rather than stopping', () => {
        const onPick = chip({ emptyLabel: undefined });
        fireEvent.click(trigger());

        const box = screen.getByLabelText('Search');
        fireEvent.keyDown(box, { key: 'ArrowUp' });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect(onPick).toHaveBeenCalledWith('employee:e1');
    });

    it('closes on Escape without writing', () => {
        const onPick = chip();
        fireEvent.click(trigger());
        fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Escape' });

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(onPick).not.toHaveBeenCalled();
    });

    it('says so when a search matches nothing', () => {
        chip({ emptyLabel: undefined });
        fireEvent.click(trigger());
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzzz' } });

        expect(screen.getByText('No data found')).toBeInTheDocument();
    });

    it('cannot be opened when disabled', () => {
        chip({ disabled: true });
        fireEvent.click(trigger());

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    /**
     * A picker holding nothing but "Unassigned" and saying nothing about it is
     * what "I cannot change the assignee" looked like in production — the roster
     * was empty and the panel gave no hint that that was the problem.
     */
    describe('the note under an empty list', () => {
        it('explains a list with no options in it', () => {
            chip({ options: [], note: 'No one is on this team yet.' });
            fireEvent.click(trigger());

            expect(screen.getByText('No one is on this team yet.')).toBeInTheDocument();
            // The "none" row is still pickable — the note explains why it is the
            // only one, it does not replace it.
            expect(screen.getByRole('option', { name: /Unassigned/ })).toBeInTheDocument();
        });

        it('stays out of the way when there is somebody to pick', () => {
            chip({ note: 'No one is on this team yet.' });
            fireEvent.click(trigger());

            expect(screen.queryByText('No one is on this team yet.')).not.toBeInTheDocument();
        });

        it('does not claim the team is empty when a search narrowed it away', () => {
            chip({ note: 'No one is on this team yet.' });
            fireEvent.click(trigger());
            fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzzz' } });

            // Three people are on this project; the filter found none of them.
            // Saying "nobody is on this team" there would be a lie.
            expect(screen.queryByText('No one is on this team yet.')).not.toBeInTheDocument();
        });
    });

    /**
     * Several values at once, for the task card's labels. The panel stays open
     * and each row toggles; unticking everything is how nothing is chosen, so
     * there is no "none" row.
     */
    describe('multiple', () => {
        const labels: ChipOption[] = [
            { value: 'l1', label: 'Blocked' },
            { value: 'l2', label: 'Client waiting' },
        ];

        const multi = (values: string[] = ['l1']) => {
            const onToggle = jest.fn();
            const onPick = chip({
                label: 'Labels',
                options: labels,
                multiple: true,
                values,
                onToggle,
                emptyLabel: 'No labels',
            });
            fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
            return { onToggle, onPick };
        };

        it('says the list holds several choices, and marks each one chosen', () => {
            multi(['l1']);

            expect(screen.getByRole('listbox', { name: 'Labels' })).toHaveAttribute(
                'aria-multiselectable',
                'true',
            );
            expect(screen.getByRole('option', { name: 'Blocked' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByRole('option', { name: 'Client waiting' })).toHaveAttribute(
                'aria-selected',
                'false',
            );
        });

        it('toggles a row and stays open for the next', () => {
            const { onToggle, onPick } = multi(['l1']);

            fireEvent.click(screen.getByRole('option', { name: 'Client waiting' }));

            expect(onToggle).toHaveBeenCalledWith('l2');
            expect(onPick).not.toHaveBeenCalled();
            expect(screen.getByRole('listbox', { name: 'Labels' })).toBeInTheDocument();
        });

        it('toggles with Enter too', () => {
            const { onToggle } = multi([]);

            fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter' });

            expect(onToggle).toHaveBeenCalledWith('l1');
        });

        it('offers no "none" row', () => {
            multi([]);

            expect(screen.queryByRole('option', { name: 'No labels' })).not.toBeInTheDocument();
        });

        it('shows its footer under the rows', () => {
            render(
                <ChipPopover
                    label="Tags"
                    value=""
                    display="Tags"
                    options={labels}
                    multiple
                    values={[]}
                    onToggle={jest.fn()}
                    footer={<a href="/settings">Manage</a>}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Tags' }));

            expect(screen.getByRole('link', { name: 'Manage' })).toBeInTheDocument();
        });
    });

    describe('field variant', () => {
        // A quiet value in a property list, not a pill: every set pill was the
        // same blue, so status, priority and sprint all looked alike.
        it('draws no pill around a set value', () => {
            chip({ variant: 'field', value: 'user:u1', display: 'Karim' });

            expect(trigger().className).not.toMatch(/rounded-full|bg-blue-50/);
        });

        it('greys an empty value rather than tinting it', () => {
            chip({ variant: 'field', tone: 'muted' });

            expect(trigger().className).toMatch(/text-gray-400/);
        });
    });
});
