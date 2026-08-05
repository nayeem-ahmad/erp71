jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');

    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ShareModal from './ShareModal';

const { enMessages } = require('@/lib/localization/messages/en');
const m = enMessages.components.shareModal;

describe('ShareModal', () => {
    const original = window.location.origin;

    it('shows the absolute short URL', () => {
        render(<ShareModal subject="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        expect(screen.getByDisplayValue(`${original}/s/aB3xK9m`)).toBeInTheDocument();
    });

    it('offers a WhatsApp share containing the link', () => {
        render(<ShareModal subject="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
        expect(whatsapp).toHaveAttribute('href', expect.stringContaining('wa.me'));
        expect(whatsapp.getAttribute('href')).toContain(encodeURIComponent(`${original}/s/aB3xK9m`));
    });

    describe('localization', () => {
        // The regression guard for the whole point of routing this modal through
        // i18n: every visible string must come from the catalog. A hardcoded
        // English literal creeping back in fails here because the catalog value
        // is what is being looked up.
        it('renders its chrome from the message catalog, with the subject interpolated', () => {
            render(<ShareModal subject="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);

            expect(screen.getByRole('heading', { name: 'Share Quotation Q-1001' })).toBeInTheDocument();
            expect(screen.getByText(m.description)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: m.copy })).toBeInTheDocument();
            expect(screen.getByRole('link', { name: m.whatsapp })).toBeInTheDocument();
            expect(screen.getByLabelText(m.close)).toBeInTheDocument();
        });

        it('never says "quotation" in its own copy — the subject is the caller\'s job', () => {
            // The spec intends this modal to be reused for storefront products.
            render(<ShareModal subject="Ceiling Fan" shortPath="/s/aB3xK9m" onClose={() => {}} />);
            expect(screen.getByText(m.description)).not.toHaveTextContent(/quotation/i);
        });
    });

    describe('revoke', () => {
        it('shows no revoke control when the caller supplies no handler', () => {
            render(<ShareModal subject="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
            expect(screen.queryByRole('button', { name: m.revoke })).not.toBeInTheDocument();
        });

        it('asks for confirmation before revoking', () => {
            const onRevoke = jest.fn().mockResolvedValue(undefined);
            render(
                <ShareModal
                    subject="Quotation Q-1001"
                    shortPath="/s/aB3xK9m"
                    onRevoke={onRevoke}
                    onClose={() => {}}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: m.revoke }));

            expect(screen.getByText(m.revokePrompt)).toBeInTheDocument();
            // The destructive call must not have fired on the first click — this
            // invalidates a URL the customer may already be holding.
            expect(onRevoke).not.toHaveBeenCalled();
        });

        it('backs out without revoking when the confirmation is declined', () => {
            const onRevoke = jest.fn().mockResolvedValue(undefined);
            render(
                <ShareModal
                    subject="Quotation Q-1001"
                    shortPath="/s/aB3xK9m"
                    onRevoke={onRevoke}
                    onClose={() => {}}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: m.revoke }));
            fireEvent.click(screen.getByRole('button', { name: m.revokeCancel }));

            expect(onRevoke).not.toHaveBeenCalled();
            expect(screen.queryByText(m.revokePrompt)).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: m.revoke })).toBeInTheDocument();
        });

        it('revokes and closes once confirmed', async () => {
            const onRevoke = jest.fn().mockResolvedValue(undefined);
            const onClose = jest.fn();
            render(
                <ShareModal
                    subject="Quotation Q-1001"
                    shortPath="/s/aB3xK9m"
                    onRevoke={onRevoke}
                    onClose={onClose}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: m.revoke }));
            fireEvent.click(screen.getByRole('button', { name: m.revokeConfirm }));

            await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(onClose).toHaveBeenCalled());
        });

        it('surfaces a failure through the Toaster and keeps the modal open', async () => {
            const { toast } = require('@/lib/toast');
            const toastErrorSpy = jest.spyOn(toast, 'error').mockImplementation(() => '');
            const alertSpy = jest.fn();
            window.alert = alertSpy;

            const onRevoke = jest.fn().mockRejectedValue(new Error('Link is already revoked'));
            const onClose = jest.fn();
            render(
                <ShareModal
                    subject="Quotation Q-1001"
                    shortPath="/s/aB3xK9m"
                    onRevoke={onRevoke}
                    onClose={onClose}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: m.revoke }));
            fireEvent.click(screen.getByRole('button', { name: m.revokeConfirm }));

            await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Link is already revoked'));
            // A revocation that failed must not look like one that worked: the
            // modal stays open with the link still shown.
            expect(onClose).not.toHaveBeenCalled();
            expect(screen.getByDisplayValue(`${window.location.origin}/s/aB3xK9m`)).toBeInTheDocument();
            expect(alertSpy).not.toHaveBeenCalled();

            toastErrorSpy.mockRestore();
        });
    });
});
