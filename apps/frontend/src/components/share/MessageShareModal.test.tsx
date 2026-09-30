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

import { fireEvent, render, screen } from '@testing-library/react';
import MessageShareModal from './MessageShareModal';

describe('MessageShareModal', () => {
    it('previews the server text and points WhatsApp at wa.me', () => {
        render(<MessageShareModal subject="Daily Report" text="No sales" onClose={() => {}} />);
        expect(screen.getByRole('textbox')).toHaveValue('No sales');
        const link = screen.getByRole('link', { name: /whatsapp/i });
        expect(link).toHaveAttribute('href', expect.stringContaining('wa.me'));
        expect(link.getAttribute('href')).toContain(encodeURIComponent('No sales'));
    });

    it('copies the edited body, not the original', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<MessageShareModal subject="Daily Report" text="No sales" onClose={() => {}} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
        fireEvent.click(screen.getByRole('button', { name: /copy/i }));
        expect(writeText).toHaveBeenCalledWith('Hello');
    });
});
