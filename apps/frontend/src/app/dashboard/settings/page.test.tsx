import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import AccountSettingsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
    },
    fetchWithAuth: jest.fn(),
}));

jest.mock('@/lib/i18n', () => ({
    useI18n: () => ({
        t: {
            settings: {
                quickLinks: {
                    localizationLabel: 'Language & Region',
                    localizationDescription: 'Manage locale, currency, and date format',
                },
            },
        },
    }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => ({
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    XCircle: () => <span data-testid="icon-x-circle" />,
    Loader2: () => <span data-testid="icon-loader" />,
    ShieldCheck: () => <span data-testid="icon-shield-check" />,
    ShieldOff: () => <span data-testid="icon-shield-off" />,
    Eye: () => <span data-testid="icon-eye" />,
    EyeOff: () => <span data-testid="icon-eye-off" />,
    Palette: () => <span data-testid="icon-palette" />,
    Receipt: () => <span data-testid="icon-receipt" />,
    Gift: () => <span data-testid="icon-gift" />,
    MessageSquare: () => <span data-testid="icon-message-square" />,
    BarChart3: () => <span data-testid="icon-bar-chart" />,
    Globe: () => <span data-testid="icon-globe" />,
    Monitor: () => <span data-testid="icon-monitor" />,
}));

describe('AccountSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getMe.mockResolvedValue({
            name: 'Test User',
            email: 'test@example.com',
            two_factor_enabled: false,
        });
    });

    it('renders the settings heading', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
        });
    });

    it('renders quick links to sub-settings pages', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Branding')).toBeInTheDocument();
            expect(screen.getByText('Tax / VAT')).toBeInTheDocument();
            expect(screen.getByText('Loyalty Program')).toBeInTheDocument();
            expect(screen.getByText('SMS Notifications')).toBeInTheDocument();
            expect(screen.getByText('Language & Region')).toBeInTheDocument();
        });
    });

    it('shows profile tab by default after loading', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });
        expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    });

    it('shows loading spinner while fetching user data', () => {
        const { api } = require('@/lib/api');
        api.getMe.mockReturnValue(new Promise(() => {})); // never resolves
        render(<AccountSettingsPage />);
        expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    });

    it('switches to password tab when clicked', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));
        expect(screen.getByText('Current Password')).toBeInTheDocument();
        expect(screen.getByText('New Password')).toBeInTheDocument();
        expect(screen.getByText('Confirm New Password')).toBeInTheDocument();
    });

    it('switches to Two-Factor Auth tab when clicked', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        expect(screen.getByText('Two-Factor Authentication is disabled')).toBeInTheDocument();
    });

    it('shows 2FA enabled state when user has 2FA enabled', async () => {
        const { api } = require('@/lib/api');
        api.getMe.mockResolvedValue({
            name: 'Test User',
            email: 'test@example.com',
            two_factor_enabled: true,
        });

        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        await waitFor(() => {
            expect(screen.getByText('Two-Factor Authentication is enabled')).toBeInTheDocument();
        });
    });

    it('saves profile name when form is submitted', async () => {
        const { fetchWithAuth } = require('@/lib/api');
        fetchWithAuth.mockResolvedValue({});

        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        const nameInput = screen.getByDisplayValue('Test User');
        fireEvent.change(nameInput, { target: { value: 'Updated Name' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith(
                '/auth/me',
                expect.objectContaining({ method: 'PATCH' }),
            );
        });
    });

    it('shows error toast when profile name is empty', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        const nameInput = screen.getByDisplayValue('Test User');
        fireEvent.change(nameInput, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => {
            expect(screen.getByText('Display name cannot be empty.')).toBeInTheDocument();
        });
    });

    it('shows password mismatch error when passwords do not match', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        const [currentInput, newInput, confirmInput] = screen.getAllByRole('textbox', { hidden: true }).filter(
            (el) => el.tagName === 'INPUT',
        );

        // Use password inputs
        const inputs = screen.getAllByPlaceholderText(/password|characters|repeat/i);
        fireEvent.change(inputs[0], { target: { value: 'OldPass123' } });
        fireEvent.change(inputs[1], { target: { value: 'NewPass123' } });
        fireEvent.change(inputs[2], { target: { value: 'Different456' } });

        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(screen.getByText('New password and confirmation do not match.')).toBeInTheDocument();
        });
    });

    it('shows error when new password is too short', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        const inputs = screen.getAllByPlaceholderText(/password|characters|repeat/i);
        fireEvent.change(inputs[0], { target: { value: 'OldPass123' } });
        fireEvent.change(inputs[1], { target: { value: 'short' } });
        fireEvent.change(inputs[2], { target: { value: 'short' } });

        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(screen.getByText('New password must be at least 8 characters.')).toBeInTheDocument();
        });
    });

    it('shows error when new password same as current', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        const inputs = screen.getAllByPlaceholderText(/password|characters|repeat/i);
        fireEvent.change(inputs[0], { target: { value: 'SamePass123' } });
        fireEvent.change(inputs[1], { target: { value: 'SamePass123' } });
        fireEvent.change(inputs[2], { target: { value: 'SamePass123' } });

        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(
                screen.getByText('New password must differ from your current password.'),
            ).toBeInTheDocument();
        });
    });

    it('generates QR code for 2FA setup', async () => {
        const { fetchWithAuth } = require('@/lib/api');
        fetchWithAuth.mockResolvedValue({
            secret: 'TESTSECRET',
            qrCodeDataUrl: 'data:image/png;base64,abc123',
            otpAuthUrl: 'otpauth://totp/test',
        });

        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        fireEvent.click(screen.getByRole('button', { name: /generate qr code/i }));

        await waitFor(() => {
            expect(screen.getByText('TESTSECRET')).toBeInTheDocument();
        });
    });

    it('shows disable 2FA form when Disable 2FA button is clicked', async () => {
        const { api } = require('@/lib/api');
        api.getMe.mockResolvedValue({
            name: 'Test User',
            email: 'test@example.com',
            two_factor_enabled: true,
        });

        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        fireEvent.click(screen.getByRole('button', { name: /disable 2fa/i }));

        await waitFor(() => {
            expect(screen.getByText('Are you sure you want to disable 2FA?')).toBeInTheDocument();
        });
    });

    it('renders all quick link hrefs correctly', async () => {
        render(<AccountSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /branding/i })).toHaveAttribute(
                'href',
                '/dashboard/settings/branding',
            );
            expect(screen.getByRole('link', { name: /tax \/ vat/i })).toHaveAttribute(
                'href',
                '/dashboard/settings/tax',
            );
            expect(screen.getByRole('link', { name: /pos counters/i })).toHaveAttribute(
                'href',
                '/dashboard/settings/counters',
            );
        });
    });
});
