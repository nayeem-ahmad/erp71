'use client';
jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({
            t: enMessages,
            locale: 'en',
            fmt: (template: string, values: Record<string, string | number> = {}) =>
                Object.entries(values).reduce(
                    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                    template,
                ),
        }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

import { fireEvent, render, screen } from '@testing-library/react';
import PurchaseReturnsModal from './PurchaseReturnsModal';

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

describe('PurchaseReturnsModal', () => {
    it('lists each return with a link to its detail page', () => {
        const onClose = jest.fn();
        render(
            <PurchaseReturnsModal
                purchaseNumber="PUR-42"
                returns={[
                    {
                        id: 'ret-1',
                        return_number: 'PR-1',
                        total_amount: '150.00',
                        notes: 'Damaged carton',
                        status: 'RECORDED',
                        created_at: '2026-03-22T09:00:00.000Z',
                        _count: { items: 2 },
                    },
                ]}
                onClose={onClose}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Purchase returns for PUR-42' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'PR-1' })).toHaveAttribute('href', '/purchases/returns/ret-1');
        expect(screen.getByText('Damaged carton')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
        expect(onClose).toHaveBeenCalled();
    });
});
