import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house
// pattern is fireEvent from @testing-library/react.
import TaskQuickAdd from './TaskQuickAdd';

const LABELS = {
    placeholder: 'Add a task — title, then Enter',
    // Deliberately not the placeholder: when the panel shared that string, a
    // `getByLabelText(/add a task/i)` matched both the input and the listbox.
    suggestions: 'Suggestions',
    hint: 'Add detail inline: @person  #label  !high  ~3h  >friday',
    project: 'Project',
    selectProject: 'Select a project',
    add: 'Add',
    more: 'More fields',
    noProjects: 'Create a project first',
};

const VOCABULARY = {
    labels: [
        { id: 'l1', name: 'Payments' },
        { id: 'l2', name: 'Client waiting' },
    ],
    assignees: [
        { key: 'user:u1', name: 'Shamim Rahman' },
        { key: 'user:u2', name: 'Karim' },
    ],
    locale: 'en-GB',
    today: 'today',
    tomorrow: 'tomorrow',
};

const compose = (onCreate = jest.fn().mockResolvedValue(undefined)) => {
    render(
        <TaskQuickAdd
            projects={[{ id: 'p1', code: 'PRJ-0001', name: 'Fit-out' }]}
            projectId="p1"
            onProjectChange={jest.fn()}
            vocabulary={VOCABULARY}
            labels={LABELS}
            onCreate={onCreate}
            onOpenFull={jest.fn()}
        />,
    );
    return { box: screen.getByLabelText(LABELS.placeholder), onCreate };
};

/** Typing has to move the caret too, or the token is read from the wrong place. */
const type = (box: HTMLElement, value: string) => {
    const input = box as HTMLInputElement;
    fireEvent.change(input, { target: { value, selectionStart: value.length } });
};

describe('TaskQuickAdd suggestions', () => {
    it('offers nothing until a sigil is typed', () => {
        const { box } = compose();
        type(box, 'Chase the refund');

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('offers the roster on @', () => {
        const { box } = compose();
        type(box, 'Chase the refund @');

        expect(screen.getByRole('option', { name: /Shamim Rahman/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Karim/ })).toBeInTheDocument();
    });

    it('narrows the roster as the name is typed', () => {
        const { box } = compose();
        type(box, 'Chase the refund @kar');

        expect(screen.getByRole('option', { name: /Karim/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Shamim/ })).not.toBeInTheDocument();
    });

    it('offers the label catalogue on #', () => {
        const { box } = compose();
        type(box, 'Chase the refund #');

        expect(screen.getByRole('option', { name: /Payments/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Client waiting/ })).toBeInTheDocument();
    });

    it('offers the four priorities on !', () => {
        const { box } = compose();
        type(box, 'Chase the refund !');

        // Matched loosely, like every other option assertion here: the row
        // renders the sigil beside the label, so the accessible name carries
        // both and its exact spacing is not what this test is about.
        expect(screen.getByRole('option', { name: /high/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /urgent/ })).toBeInTheDocument();
    });

    /**
     * `~` is a sigil the grammar parses but nothing can suggest — an estimate is
     * a freeform number. It must open no panel rather than an empty one. Pinned
     * so nobody later "fixes" it into a dropdown with nothing in it.
     */
    it('offers nothing for an estimate', () => {
        const { box } = compose();
        type(box, 'Chase the refund ~');

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('completes a token on click, and leaves the caret after it', () => {
        const { box } = compose();
        type(box, 'Chase the refund @sha');

        fireEvent.mouseDown(screen.getByRole('option', { name: /Shamim Rahman/ }));

        // The first name, because that is what the parser resolves by prefix.
        expect((box as HTMLInputElement).value).toBe('Chase the refund @Shamim ');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('joins a multi-word label into one token', () => {
        const { box } = compose();
        type(box, 'Chase the refund #client');

        fireEvent.mouseDown(screen.getByRole('option', { name: /Client waiting/ }));

        // A token cannot contain a space, and `parseQuickAdd` folds punctuation
        // out of both sides when matching — so `#Clientwaiting` resolves.
        expect((box as HTMLInputElement).value).toBe('Chase the refund #Clientwaiting ');
    });

    it('moves through the suggestions with the arrow keys', () => {
        const { box } = compose();
        type(box, 'Chase the refund @');

        fireEvent.keyDown(box, { key: 'ArrowDown' });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect((box as HTMLInputElement).value).toBe('Chase the refund @Karim ');
    });

    it('completes with Tab as well', () => {
        const { box } = compose();
        type(box, 'Chase the refund @kar');
        fireEvent.keyDown(box, { key: 'Tab' });

        expect((box as HTMLInputElement).value).toBe('Chase the refund @Karim ');
    });

    /**
     * The behaviour change worth covering: Enter used to save, full stop. It now
     * completes the token being typed first, and only saves once there is
     * nothing to complete.
     */
    it('Enter completes a suggestion rather than saving', () => {
        const { box, onCreate } = compose();
        type(box, 'Chase the refund @sha');

        fireEvent.keyDown(box, { key: 'Enter' });

        expect(onCreate).not.toHaveBeenCalled();
        expect((box as HTMLInputElement).value).toBe('Chase the refund @Shamim ');
    });

    it('Enter still saves when nothing is being completed', async () => {
        const { box, onCreate } = compose();
        type(box, 'Chase the refund');

        fireEvent.keyDown(box, { key: 'Enter' });

        await waitFor(() => expect(onCreate).toHaveBeenCalled());
        expect(onCreate.mock.calls[0][0]).toMatchObject({ title: 'Chase the refund' });
    });

    it('Escape dismisses the suggestions before it clears the line', () => {
        const { box } = compose();
        type(box, 'Chase the refund @sha');

        fireEvent.keyDown(box, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        // The line survives the first Escape.
        expect((box as HTMLInputElement).value).toBe('Chase the refund @sha');

        fireEvent.keyDown(box, { key: 'Escape' });
        expect((box as HTMLInputElement).value).toBe('');
    });
});
