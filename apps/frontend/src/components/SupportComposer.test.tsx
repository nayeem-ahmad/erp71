import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportComposer, {
    availableKnockCategories,
    defaultKnockCategory,
} from './SupportComposer';
import { useToastStore } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        createSupportThread: jest.fn(),
    },
}));

/**
 * Types into a `RichTextEditor` (contenteditable). `fireEvent.change` has no
 * value setter there — paste through ProseMirror is what produces a document
 * the editor serializes back to markdown.
 */
const typeInEditor = (editor: HTMLElement, text: string) => {
    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.paste(editor, {
        clipboardData: {
            files: [],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
            types: ['text/plain'],
        },
    });
};

const messageEditor = () => screen.getByRole('textbox', { name: 'Message' });

describe('availableKnockCategories', () => {
    it('includes help only when support is on', () => {
        expect(availableKnockCategories(true, false)).toEqual(['support']);
    });

    it('includes feedback types only when feedback is on', () => {
        expect(availableKnockCategories(false, true)).toEqual(['bug', 'feature', 'general']);
    });

    it('includes every type when both flags are on', () => {
        expect(availableKnockCategories(true, true)).toEqual(['support', 'bug', 'feature', 'general']);
    });
});

describe('defaultKnockCategory', () => {
    it('prefers help when support is on', () => {
        expect(defaultKnockCategory(true, true)).toBe('support');
    });

    it('falls back to other when only feedback is on', () => {
        expect(defaultKnockCategory(false, true)).toBe('general');
    });
});

describe('SupportComposer', () => {
    it('hides the help chip when support is off', () => {
        render(
            <SupportComposer
                supportEnabled={false}
                feedbackEnabled
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'I need help' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bug' })).toBeInTheDocument();
    });

    it('hides feedback chips when feedback is off', () => {
        render(
            <SupportComposer
                supportEnabled
                feedbackEnabled={false}
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Bug' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'I need help' })).not.toBeInTheDocument();
    });

    it('hands the new ticket back and says its number', async () => {
        const { api } = require('@/lib/api');
        api.createSupportThread.mockResolvedValue({ id: 'thr-1', ticketNumber: 12 });
        useToastStore.setState({ toasts: [] });
        const onCreated = jest.fn();

        render(
            <SupportComposer
                supportEnabled
                feedbackEnabled={false}
                onCreated={onCreated}
                onCancel={jest.fn()}
            />,
        );
        typeInEditor(messageEditor(), 'The printer does nothing');
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'thr-1', ticketNumber: 12 }));
        // Said here rather than by the caller, because the widget navigates away
        // the moment this resolves.
        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'Ticket #12 created.',
        ]);
    });

    it('lets the user pick a type when both flags are on', () => {
        const { container } = render(
            <SupportComposer
                supportEnabled
                feedbackEnabled
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'I need help' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Feature' }));
        // TipTap puts the empty-state copy on the empty paragraph, not the
        // textbox itself — see `.prose-editor p.is-editor-empty` in globals.css.
        expect(container.querySelector('[data-placeholder]')).toHaveAttribute(
            'data-placeholder',
            'Describe the bug, idea, or other feedback…',
        );
    });

    it('offers a bigger, resizable rich-text description', () => {
        const { container } = render(
            <SupportComposer
                supportEnabled
                feedbackEnabled={false}
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
        const box = container.querySelector('[data-rich-text-editor] .resize-y') as HTMLElement | null;
        expect(box).toBeTruthy();
        expect(box!.style.minHeight).toBe('12rem');
    });
});

describe('SupportComposer attachments', () => {
    const renderComposer = (onCreated = jest.fn()) =>
        render(
            <SupportComposer
                supportEnabled
                feedbackEnabled={false}
                onCreated={onCreated}
                onCancel={jest.fn()}
            />,
        );
    const pick = (...files: File[]) =>
        fireEvent.change(screen.getByLabelText('Attach file', { selector: 'input' }), {
            target: { files },
        });

    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.createSupportThread.mockReset();
    });

    it('sends picked files with the ticket', async () => {
        const { api } = require('@/lib/api');
        api.createSupportThread.mockResolvedValue({ id: 'thr-2', ticketNumber: 13 });
        const onCreated = jest.fn();
        renderComposer(onCreated);

        const shot = new File(['png'], 'screen.png', { type: 'image/png' });
        pick(shot);
        expect(screen.getByText('screen.png')).toBeInTheDocument();

        typeInEditor(messageEditor(), 'Totals look wrong');
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        expect(api.createSupportThread).toHaveBeenCalledWith(
            expect.objectContaining({ body: 'Totals look wrong', attachments: [shot] }),
        );
    });

    it('lets an attachment stand in for the written message', async () => {
        const { api } = require('@/lib/api');
        api.createSupportThread.mockResolvedValue({ id: 'thr-3', ticketNumber: 14 });
        renderComposer();

        const send = screen.getByRole('button', { name: 'Send' });
        expect(send).toBeDisabled();
        pick(new File(['ogg'], 'voice.ogg', { type: 'audio/ogg' }));
        expect(send).not.toBeDisabled();

        fireEvent.click(send);
        await waitFor(() => expect(api.createSupportThread).toHaveBeenCalledWith(
            expect.objectContaining({ body: '' }),
        ));
    });

    it('refuses an unsupported file inline', () => {
        renderComposer();
        pick(new File(['x'], 'setup.exe', { type: 'application/x-msdownload' }));
        expect(screen.getByRole('alert')).toHaveTextContent('That file type is not supported');
        expect(screen.queryByText('setup.exe')).not.toBeInTheDocument();
    });

    it('stops at five files', () => {
        renderComposer();
        const files = Array.from({ length: 6 }, (_, i) => new File(['x'], `${i}.png`, { type: 'image/png' }));
        pick(...files);
        expect(screen.getByRole('alert')).toHaveTextContent('You can attach up to 5 files.');
        expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(5);
    });

    it('removes a pending file', () => {
        renderComposer();
        pick(new File(['x'], 'a.png', { type: 'image/png' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
        expect(screen.queryByText('a.png')).not.toBeInTheDocument();
    });
});
