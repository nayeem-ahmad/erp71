import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePage from './page';
import Toaster from '@/components/Toaster';

function renderProfilePage() {
    return render(
        <>
            <ProfilePage />
            <Toaster />
        </>,
    );
}

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        updateProfileAvatar: jest.fn(),
    },
    fetchWithAuth: jest.fn(),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({
            t: enMessages,
        }),
    };
});

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@/components/AvatarCropModal', () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('ProfilePage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getMe.mockResolvedValue({
            name: 'Test User',
            email: 'test@example.com',
            two_factor_enabled: false,
        });
    });

    it('renders the profile heading', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Profile');
        });
    });

    it('renders account tabs', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Password' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Two-Factor Auth' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Data & Privacy' })).toBeInTheDocument();
        });
    });

    it('shows profile tab by default after loading', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });
        expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    });

    it('shows loading state while fetching user data', () => {
        const { api } = require('@/lib/api');
        api.getMe.mockReturnValue(new Promise(() => {})); // never resolves
        renderProfilePage();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('switches to password tab when clicked', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));
        expect(screen.getByText('Current Password')).toBeInTheDocument();
        expect(screen.getByText('New Password')).toBeInTheDocument();
        expect(screen.getByText('Confirm New Password')).toBeInTheDocument();
    });

    it('switches to Two-Factor Auth tab when clicked', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
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

        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        await waitFor(() => {
            expect(screen.getByText('Two-Factor Authentication is enabled')).toBeInTheDocument();
        });
    });

    it('saves profile name when form is submitted', async () => {
        const { fetchWithAuth } = require('@/lib/api');
        fetchWithAuth.mockResolvedValue({});

        renderProfilePage();
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
        renderProfilePage();
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

    it('shows error when current password is empty', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
        });

        // Submit with no values filled in
        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(
                screen.getByText('Please enter your current password.'),
            ).toBeInTheDocument();
        });
    });

    it('shows error when new password is too short', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Enter current password')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
            target: { value: 'OldPass123' },
        });
        fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
            target: { value: 'short' },
        });
        fireEvent.change(screen.getByPlaceholderText('Repeat new password'), {
            target: { value: 'short' },
        });

        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(screen.getByText('New password must be at least 8 characters.')).toBeInTheDocument();
        });
    });

    it('shows password mismatch error when passwords do not match', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Enter current password')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
            target: { value: 'OldPass123' },
        });
        fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
            target: { value: 'NewPass123' },
        });
        fireEvent.change(screen.getByPlaceholderText('Repeat new password'), {
            target: { value: 'Different456' },
        });

        fireEvent.click(screen.getByRole('button', { name: /change password/i }));

        await waitFor(() => {
            expect(screen.getByText('New password and confirmation do not match.')).toBeInTheDocument();
        });
    });

    it('shows error when new password same as current', async () => {
        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Password' }));

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Enter current password')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByPlaceholderText('Enter current password'), {
            target: { value: 'SamePass123' },
        });
        fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
            target: { value: 'SamePass123' },
        });
        fireEvent.change(screen.getByPlaceholderText('Repeat new password'), {
            target: { value: 'SamePass123' },
        });

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

        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
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

        renderProfilePage();
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Two-Factor Auth' }));
        fireEvent.click(screen.getByRole('button', { name: /disable 2fa/i }));

        await waitFor(() => {
            expect(screen.getByText('Are you sure you want to disable 2FA?')).toBeInTheDocument();
        });
    });
});
