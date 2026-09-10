jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number>) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CancelEntryModal } from './CancelEntryModal';
import { enMessages } from '@/lib/localization/messages/en';

const copy = enMessages.entryCancellation;

function renderModal(overrides: Partial<React.ComponentProps<typeof CancelEntryModal>> = {}) {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(
        <CancelEntryModal
            entryLabel="INV-00042"
            entryAmount="৳1,400"
            onConfirm={onConfirm}
            onClose={onClose}
            {...overrides}
        />,
    );
    return { onConfirm, onClose };
}

const noteBox = () => screen.getByLabelText(new RegExp(copy.noteLabel));

describe('CancelEntryModal', () => {
    it('names the entry and warns that its impacts will be reversed', () => {
        renderModal();

        expect(screen.getByText(/INV-00042/)).toBeInTheDocument();
        expect(screen.getByText(copy.warning)).toBeInTheDocument();
    });

    it('refuses to submit without a note, and says so inline rather than in an alert', async () => {
        const { onConfirm } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.confirm) }));

        expect(await screen.findByText(copy.noteRequired)).toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only note as no note at all', async () => {
        const { onConfirm } = renderModal();

        fireEvent.change(noteBox(), { target: { value: '    ' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.confirm) }));

        expect(await screen.findByText(copy.noteRequired)).toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('asks for more than a single character', async () => {
        const { onConfirm } = renderModal();

        fireEvent.change(noteBox(), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.confirm) }));

        expect(await screen.findByText(/at least 5 characters/)).toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('confirms with the trimmed note', async () => {
        const { onConfirm } = renderModal();

        fireEvent.change(noteBox(), { target: { value: '  Duplicate of INV-00041  ' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.confirm) }));

        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Duplicate of INV-00041'));
    });

    it('keeps the typed note and shows the server error when the cancel is refused', async () => {
        const onConfirm = jest
            .fn()
            .mockRejectedValue(new Error('This sale has returns against it — delete or reverse them first.'));
        render(
            <CancelEntryModal
                entryLabel="INV-00042"
                onConfirm={onConfirm}
                onClose={jest.fn()}
            />,
        );

        fireEvent.change(noteBox(), { target: { value: 'Recorded in error' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.confirm) }));

        expect(
            await screen.findByText('This sale has returns against it — delete or reverse them first.'),
        ).toBeInTheDocument();
        expect(noteBox()).toHaveValue('Recorded in error');
    });

    it('closes without cancelling anything when the entry is kept', () => {
        const { onClose, onConfirm } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: copy.keep }));

        expect(onClose).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
