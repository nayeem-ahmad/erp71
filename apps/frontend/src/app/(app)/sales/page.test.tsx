'use client';
jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
      locale: 'en',
    }),
    formatMessage: (template, values = {}) =>
      Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
      ),
  };
}, { virtual: true });

import { render, screen, waitFor } from '@testing-library/react';
import SalesHubPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({
            tenants: [{
                id: 'tenant-1',
                subscription: { plan: { code: 'BASIC', features_json: {} } },
            }],
        }),
        getSalesSettings: jest.fn().mockResolvedValue({ pos_enabled: true }),
    },
}));

describe('SalesHubPage', () => {
    beforeEach(() => {
        localStorage.setItem('tenant_id', 'tenant-1');
    });

    it('renders the sales hub heading', () => {
        render(<SalesHubPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sales & Customer Operations' })).toBeInTheDocument();
    });

    it('shows daily operation entry points', async () => {
        render(<SalesHubPage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /New Sales Entry/i })).toHaveAttribute('href', '/sales/new');
            expect(screen.getByRole('link', { name: /^Sales$/i })).toHaveAttribute('href', '/sales/list');
        });
    });

    it('does not show a Point of Sale link', async () => {
        render(<SalesHubPage />);
        await waitFor(() => {
            expect(screen.queryByRole('link', { name: /Point of Sale/i })).toBeNull();
        });
    });

    it('shows setup links', async () => {
        render(<SalesHubPage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /Customer Groups/i })).toHaveAttribute('href', '/sales/customer-groups');
        });
    });
});