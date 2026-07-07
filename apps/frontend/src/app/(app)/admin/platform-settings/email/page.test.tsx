import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminEmailSettingsPage from './page';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/admin/platform-settings/email'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

const mockSettings = {
    smtp_host: 'smtp.example.com',
    smtp_port: '587',
    smtp_user: 'admin@example.com',
    smtp_pass: 'secret',
    email_from: 'noreply@example.com',
    frontend_url: 'https://example.com',
};

function getFetchWithAuth() {
    return require('@/lib/api').fetchWithAuth;
}

describe('AdminEmailSettingsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getFetchWithAuth().mockResolvedValue(mockSettings);
    });

    it('renders the page heading', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getAllByText(/email/i).length).toBeGreaterThan(0);
        });
    });

    it('calls fetchWithAuth to load settings on mount', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(getFetchWithAuth()).toHaveBeenCalledWith('/admin/platform-settings/email');
        });
    });

    it('populates SMTP host field', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('smtp.example.com')).toBeInTheDocument();
        });
    });

    it('populates SMTP port field', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('587')).toBeInTheDocument();
        });
    });

    it('populates email from field', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('noreply@example.com')).toBeInTheDocument();
        });
    });

    it('shows Save Settings button', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
        });
    });

    it('calls PATCH on save', async () => {
        const fetchWithAuth = getFetchWithAuth();
        fetchWithAuth.mockResolvedValue(mockSettings);
        render(<AdminEmailSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save settings/i }));
        fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
        await waitFor(() => {
            expect(fetchWithAuth).toHaveBeenCalledWith(
                '/admin/platform-settings/email',
                expect.objectContaining({ method: 'PATCH' })
            );
        });
    });

    it('shows success toast after save', async () => {
        const fetchWithAuth = getFetchWithAuth();
        fetchWithAuth.mockResolvedValue(mockSettings);
        render(<AdminEmailSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save settings/i }));
        fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
        await waitFor(() => {
            expect(screen.getByText(/email settings saved/i)).toBeInTheDocument();
        });
    });

    it('shows Send test email button', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            const buttons = screen.getAllByRole('button');
            const sendBtn = buttons.find(b => b.textContent?.includes('Send'));
            expect(sendBtn).toBeInTheDocument();
        });
    });

    it('shows frontend URL field', async () => {
        render(<AdminEmailSettingsPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();
        });
    });

    it('shows error toast when save fails', async () => {
        const fetchWithAuth = getFetchWithAuth();
        fetchWithAuth
            .mockResolvedValueOnce(mockSettings)
            .mockRejectedValueOnce(new Error('Save failed'));
        render(<AdminEmailSettingsPage />);
        await waitFor(() => screen.getByRole('button', { name: /save settings/i }));
        fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
        await waitFor(() => {
            expect(screen.getByText(/save failed/i)).toBeInTheDocument();
        });
    });
});
