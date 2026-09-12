import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_PASSWORD_POLICY } from '@erp71/shared-types';
import SetPasswordGate from './SetPasswordGate';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages }) };
});

jest.mock('@/lib/api', () => ({
    api: {
        changePassword: jest.fn(),
        getTenantPasswordPolicy: jest.fn(),
    },
}));

jest.mock('@/lib/auth-session', () => ({ clearAuthSession: jest.fn() }));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fill = (label: RegExp, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/**
 * Render and wait for the policy fetch to land. Every test needs this: the
 * component loads the workspace's rules on mount, and asserting before that
 * resolves leaves a state update outside `act`.
 */
const renderGate = async () => {
    render(<SetPasswordGate />);
    await screen.findByRole('button', { name: /set password/i });
};

describe('SetPasswordGate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getTenantPasswordPolicy.mockResolvedValue(DEFAULT_PASSWORD_POLICY);
        api.changePassword.mockResolvedValue({});
    });

    it('asks for the temporary password and a replacement', async () => {
        await renderGate();
        expect(screen.getByRole('heading', { name: /set your password/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/temporary password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    });

    it('shows the workspace rules, not the platform default', async () => {
        const { api } = require('@/lib/api');
        api.getTenantPasswordPolicy.mockResolvedValue({
            ...DEFAULT_PASSWORD_POLICY,
            min_length: 14,
            require_symbol: true,
        });
        render(<SetPasswordGate />);

        expect(await screen.findByText('At least 14 characters')).toBeInTheDocument();
        expect(screen.getByText('A symbol')).toBeInTheDocument();
    });

    it('renders even when the policy cannot be read', async () => {
        // `/tenants/password-policy` is one of four endpoints the guard still
        // allows, but a failure there must not leave someone stuck on a blank
        // screen with no way to set a password.
        const { api } = require('@/lib/api');
        api.getTenantPasswordPolicy.mockRejectedValue(new Error('offline'));
        await renderGate();

        // Falls back to the platform default rather than rendering nothing.
        expect(await screen.findByText('At least 8 characters')).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    });

    it('refuses a mismatched confirmation without calling the API', async () => {
        const { api } = require('@/lib/api');
        await renderGate();

        fill(/temporary password/i, 'Temp7Gecko#4');
        fill(/^new password/i, 'Marble9Tundra@2');
        fill(/confirm new password/i, 'Marble9Tundra@3');
        fireEvent.click(screen.getByRole('button', { name: /set password/i }));

        expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
        expect(api.changePassword).not.toHaveBeenCalled();
    });

    it('changes the password and sends them back to sign in', async () => {
        const { api } = require('@/lib/api');
        const { clearAuthSession } = require('@/lib/auth-session');
        await renderGate();

        fill(/temporary password/i, 'Temp7Gecko#4');
        fill(/^new password/i, 'Marble9Tundra@2');
        fill(/confirm new password/i, 'Marble9Tundra@2');
        fireEvent.click(screen.getByRole('button', { name: /set password/i }));

        await waitFor(() => {
            expect(api.changePassword).toHaveBeenCalledWith({
                currentPassword: 'Temp7Gecko#4',
                newPassword: 'Marble9Tundra@2',
            });
        });
        // The change bumps `token_version`, so the session is already dead.
        // Staying put would mean every later request 401ing unexplained.
        expect(clearAuthSession).toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith('/login');
    });

    it("shows the server's reason when it refuses the new password", async () => {
        const { api } = require('@/lib/api');
        api.changePassword.mockRejectedValue(new Error('Password must be at least 12 characters.'));
        await renderGate();

        fill(/temporary password/i, 'Temp7Gecko#4');
        fill(/^new password/i, 'short');
        fill(/confirm new password/i, 'short');
        fireEvent.click(screen.getByRole('button', { name: /set password/i }));

        expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
    });

    it('offers no way past itself', async () => {
        // There is deliberately no skip, dismiss or "later". The backend would
        // refuse anyway; a control that looked like an escape would only mislead.
        await renderGate();
        const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
        expect(labels).toEqual(['Set password']);
    });
});
