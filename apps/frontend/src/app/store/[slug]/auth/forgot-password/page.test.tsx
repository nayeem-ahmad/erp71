import { fireEvent, render, screen } from '@testing-library/react';
import StorefrontForgotPasswordPage from './page';

jest.mock('next/navigation', () => ({
    useParams: () => ({ slug: 'dhaka-mart' }),
}));

jest.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function json(body: unknown, ok = true) {
    return Promise.resolve({ ok, json: async () => body } as Response);
}

describe('StorefrontForgotPasswordPage', () => {
    beforeEach(() => mockFetch.mockReset());

    it('asks this shop for the link, not the ERP', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/meta') ? json({ data: { name: 'Dhaka Mart' } }) : json({ data: { message: 'sent' } }),
        );

        render(<StorefrontForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' karim@example.com ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

        expect(await screen.findByText(/a reset link is on its way/)).toBeInTheDocument();
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/storefront/dhaka-mart/auth/forgot-password'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'karim@example.com' }) }),
        );
        expect(await screen.findByText('Dhaka Mart')).toBeInTheDocument();
    });

    it('shows the error when the request is refused', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/meta')
                ? json({ data: { name: 'Dhaka Mart' } })
                : json({ error: { message: 'Too many requests' } }, false),
        );

        render(<StorefrontForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'karim@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

        expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    });
});
