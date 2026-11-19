import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailServerSettingsPage from './page';

const mockFetch = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock('@/lib/api', () => ({
    fetchWithAuth: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('@/lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: jest.fn(),
    },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }) };
});

const MASK = '••••••••';

function settings(overrides: Record<string, unknown> = {}) {
    return {
        enabled: false,
        host: 'smtp.gmail.com',
        port: 587,
        security: 'starttls',
        username: 'shop@gmail.com',
        password: MASK,
        from_email: 'shop@gmail.com',
        from_name: 'Shop',
        reply_to: '',
        verified_at: null,
        last_error: null,
        last_error_at: null,
        updated_at: '2026-11-19T08:00:00.000Z',
        ...overrides,
    };
}

function empty() {
    return settings({
        host: '',
        username: '',
        password: '',
        from_email: '',
        from_name: '',
        updated_at: null,
    });
}

describe('EmailServerSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('cannot be switched on before a test has passed', async () => {
        mockFetch.mockResolvedValueOnce(settings());
        render(<EmailServerSettingsPage />);

        const toggle = await screen.findByRole('switch', { name: 'Send through my server' });
        expect(toggle).toBeDisabled();
        expect(screen.getByText('Not tested')).toBeInTheDocument();
    });

    it('can be switched on once the saved settings have been tested', async () => {
        mockFetch
            .mockResolvedValueOnce(settings({ verified_at: '2026-11-19T08:05:00.000Z' }))
            .mockResolvedValueOnce(settings({ enabled: true, verified_at: '2026-11-19T08:05:00.000Z' }));
        render(<EmailServerSettingsPage />);

        fireEvent.click(await screen.findByRole('switch', { name: 'Send through my server' }));

        await waitFor(() =>
            expect(mockFetch).toHaveBeenLastCalledWith('/tenants/email-server', expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ enabled: true }),
            })),
        );
        expect(await screen.findByText('On')).toBeInTheDocument();
    });

    it('keeps the stored password when the field is left blank', async () => {
        mockFetch.mockResolvedValueOnce(settings()).mockResolvedValueOnce(settings({ from_name: 'Shop Ltd' }));
        render(<EmailServerSettingsPage />);

        fireEvent.change(await screen.findByLabelText('Sender name'), { target: { value: 'Shop Ltd' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
        const body = JSON.parse(mockFetch.mock.calls[1][1].body);
        expect(body).not.toHaveProperty('password');
        expect(body.from_name).toBe('Shop Ltd');
    });

    it('shows missing fields inline instead of saving', async () => {
        mockFetch.mockResolvedValueOnce(empty());
        render(<EmailServerSettingsPage />);

        fireEvent.change(await screen.findByLabelText('Sender name'), { target: { value: 'Shop' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Enter the SMTP server.')).toBeInTheDocument();
        expect(screen.getByText('Enter the password.')).toBeInTheDocument();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fills a provider preset', async () => {
        mockFetch.mockResolvedValueOnce(empty());
        render(<EmailServerSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Zoho Mail' }));

        expect(screen.getByLabelText(/^SMTP server/)).toHaveValue('smtp.zoho.com');
        expect(screen.getByLabelText('Port')).toHaveValue('465');
        expect(screen.getByLabelText('Security')).toHaveValue('ssl');
    });

    it('shows the server answer when the test fails', async () => {
        mockFetch
            .mockResolvedValueOnce(settings())
            .mockRejectedValueOnce(new Error('The server rejected the username or password.'))
            .mockResolvedValueOnce(settings({ last_error: 'The server rejected the username or password.' }));
        render(<EmailServerSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /Send test/ }));

        expect(await screen.findAllByText('The server rejected the username or password.')).not.toHaveLength(0);
        expect(mockFetch).toHaveBeenCalledWith('/tenants/email-server/test', expect.objectContaining({ method: 'POST' }));
    });

    it('will not test unsaved changes', async () => {
        mockFetch.mockResolvedValueOnce(settings());
        render(<EmailServerSettingsPage />);

        fireEvent.change(await screen.findByLabelText(/^SMTP server/), { target: { value: 'smtp.other.com' } });

        expect(screen.getByRole('button', { name: /Send test/ })).toBeDisabled();
        expect(screen.getByText('Save your changes before testing.')).toBeInTheDocument();
    });
});
