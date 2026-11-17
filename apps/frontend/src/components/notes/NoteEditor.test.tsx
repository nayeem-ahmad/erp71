import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteEditor } from './NoteEditor';

jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { ...actual, useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

jest.mock('@/lib/api', () => ({
    api: {
        getNote: jest.fn(),
        updateNote: jest.fn(),
        deleteNote: jest.fn(),
        uploadNoteImage: jest.fn(),
        getUploadSignature: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/*
 * The real editor is TipTap in a contenteditable, which jsdom cannot type
 * into. A textarea stands in for it, with a button for "an upload started /
 * finished" — the two things this component reacts to.
 */
jest.mock('@/components/ui/LazyRichTextEditor', () => ({
    RichTextEditor: (props: {
        value: string;
        onChange: (value: string) => void;
        ariaLabel?: string;
        uploadImage?: unknown;
        onUploadingChange?: (uploading: boolean) => void;
    }) => (
        <div>
            <textarea aria-label={props.ariaLabel} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
            <span data-testid="can-upload">{props.uploadImage ? 'yes' : 'no'}</span>
            <button type="button" onClick={() => props.onUploadingChange?.(true)}>start upload</button>
            <button type="button" onClick={() => props.onUploadingChange?.(false)}>finish upload</button>
        </div>
    ),
}));

const { api } = jest.requireMock('@/lib/api') as {
    api: Record<'getNote' | 'updateNote' | 'deleteNote', jest.Mock>;
};

const stored = {
    id: 'n1',
    title: 'Shopping',
    content: 'Rice',
    pinned: false,
    created_at: '2026-11-17T08:00:00Z',
    updated_at: '2026-11-17T08:00:00Z',
};

async function renderEditor(overrides: Partial<Parameters<typeof NoteEditor>[0]> = {}) {
    const props = { noteId: 'n1', onSaved: jest.fn(), onDeleted: jest.fn(), onBack: jest.fn(), ...overrides };
    const view = render(<NoteEditor {...props} />);
    await screen.findByDisplayValue('Shopping');
    return { ...props, ...view };
}

beforeEach(() => {
    jest.useFakeTimers();
    api.getNote.mockResolvedValue(stored);
    api.updateNote.mockImplementation((_id: string, body: object) =>
        Promise.resolve({ ...stored, ...body, updated_at: '2026-11-17T09:00:00Z' }),
    );
    api.deleteNote.mockResolvedValue({ id: 'n1' });
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe('NoteEditor', () => {
    it('opens the note with picture uploads switched on', async () => {
        await renderEditor();
        expect(screen.getByLabelText('Note')).toHaveValue('Rice');
        expect(screen.getByTestId('can-upload')).toHaveTextContent('yes');
        expect(api.updateNote).not.toHaveBeenCalled();
    });

    it('saves a moment after typing stops, and tells the list', async () => {
        const { onSaved } = await renderEditor();

        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Rice and lentils' } });
        expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
        expect(api.updateNote).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(800);
        });

        expect(api.updateNote).toHaveBeenCalledTimes(1);
        expect(api.updateNote).toHaveBeenCalledWith('n1', { title: 'Shopping', content: 'Rice and lentils' });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ content: 'Rice and lentils' })));
        expect(screen.getByRole('status')).toHaveTextContent('Saved');
    });

    it('holds the save while a picture uploads, then saves once it lands', async () => {
        await renderEditor();

        fireEvent.click(screen.getByText('start upload'));
        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Rice ![x](blob:local)' } });
        await act(async () => {
            jest.advanceTimersByTime(5_000);
        });
        expect(api.updateNote).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Uploading pictures');

        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Rice ![x](https://res.cloudinary.com/a.png)' } });
        fireEvent.click(screen.getByText('finish upload'));
        await act(async () => {
            jest.advanceTimersByTime(800);
        });
        expect(api.updateNote).toHaveBeenCalledTimes(1);
        expect(api.updateNote).toHaveBeenCalledWith('n1', expect.objectContaining({ content: 'Rice ![x](https://res.cloudinary.com/a.png)' }));
    });

    it('saves a pending edit when it closes before the timer fires', async () => {
        const { unmount } = await renderEditor();
        fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Groceries' } });

        await act(async () => {
            unmount();
        });

        expect(api.updateNote).toHaveBeenCalledWith('n1', { title: 'Groceries', content: 'Rice' });
    });

    it('pins the note', async () => {
        const { onSaved } = await renderEditor();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pin to top' }));
        });
        expect(api.updateNote).toHaveBeenCalledWith('n1', { pinned: true });
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }));
        expect(screen.getByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('deletes only after the confirmation', async () => {
        const { onDeleted } = await renderEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
        expect(api.deleteNote).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        });
        expect(api.deleteNote).toHaveBeenCalledWith('n1');
        expect(onDeleted).toHaveBeenCalledWith('n1');
    });
});
