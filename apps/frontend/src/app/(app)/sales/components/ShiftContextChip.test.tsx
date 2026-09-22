'use client';
jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({ t: enMessages, locale: 'en' }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });

import { render, screen, waitFor } from '@testing-library/react';
import ShiftContextChip from './ShiftContextChip';

jest.mock('@/lib/api', () => ({
    api: { getOpenCashierSession: jest.fn() },
}));

const { api } = require('@/lib/api');

describe('ShiftContextChip', () => {
    beforeEach(() => jest.clearAllMocks());

    it('names the counter the sale will be stamped with', async () => {
        api.getOpenCashierSession.mockResolvedValue({
            id: 's1',
            opened_at: '2026-09-23T09:15:00.000Z',
            counter: { name: 'Counter 2' },
        });

        render(<ShiftContextChip />);

        expect(await screen.findByText(/Counter 2/)).toBeInTheDocument();
    });

    it('says the sale will not be attached to a till when no shift is open', async () => {
        api.getOpenCashierSession.mockResolvedValue(null);

        render(<ShiftContextChip />);

        expect(await screen.findByText('No open shift')).toBeInTheDocument();
        expect(
            screen.getByText("This sale won't be attached to a till."),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open a shift' })).toHaveAttribute(
            'href',
            '/sales/cashier-sessions',
        );
    });

    it('falls back to the active-session label when a shift has no counter', async () => {
        // Counters are optional: running shifts without tagging tills is a
        // supported setup, and must not render "Counter undefined".
        api.getOpenCashierSession.mockResolvedValue({ id: 's1', counter: null });

        render(<ShiftContextChip />);

        expect(await screen.findByText('Session Active')).toBeInTheDocument();
        expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });

    it('claims nothing while the answer is still in flight', () => {
        api.getOpenCashierSession.mockReturnValue(new Promise(() => {}));

        const { container } = render(<ShiftContextChip />);

        expect(container).toBeEmptyDOMElement();
    });

    it('treats a failed lookup as no shift rather than blocking entry', async () => {
        api.getOpenCashierSession.mockRejectedValue(new Error('offline'));

        render(<ShiftContextChip />);

        await waitFor(() =>
            expect(screen.getByText('No open shift')).toBeInTheDocument(),
        );
    });
});
