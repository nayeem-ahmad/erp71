/**
 * Tests for the page a password reset or partner invite link lands on.
 *
 * The page calls the backend with bare `fetch`, so it has to read the backend's
 * real shapes itself: a success arrives inside the TransformInterceptor's
 * `{ data }` envelope and a rejection as the HttpExceptionFilter's
 * `{ error: { code, message } }`. Every mock here uses exactly those shapes.
 * Reading `valid` off the envelope instead of its contents is how every fresh
 * reset link came to be announced as expired the moment it opened.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PASSWORD_POLICY } from '@erp71/shared-types';
import ResetPasswordPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => ({ get: (key: string) => (key === 'token' ? 'a1b2c3' : null) }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const EXPIRED = 'Reset failed. The link may have expired.';

/** A success as the backend sends it: inside the TransformInterceptor's envelope. */
function ok(data: unknown) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
}

/** A rejection as the backend sends it: the HttpExceptionFilter's shape. */
function rejected(status: number, message: string) {
    return Promise.resolve({
        ok: false,
        status,
        json: async () => ({ error: { code: 'BAD_REQUEST', message } }),
    } as Response);
}

/** What `GET /auth/reset-token/:token` says about a live, unused reset token. */
function tokenStatus(overrides: Record<string, unknown> = {}) {
    return {
        valid: true,
        expired: false,
        used: false,
        purpose: 'PASSWORD_RESET',
        canResend: false,
        passwordPolicy: DEFAULT_PASSWORD_POLICY,
        ...overrides,
    };
}

/** Answers each call by path, so a request to an unexpected endpoint fails loudly. */
function serve(routes: Record<string, () => Promise<Response>>) {
    mockFetch.mockImplementation((url: string) => {
        const path = Object.keys(routes).find((candidate) => url.includes(candidate));
        if (!path) throw new Error(`Unexpected request: ${url}`);
        return routes[path]();
    });
}

/** Lets the on-load token check run to completion, whatever it decides. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function submitNewPassword(password: string) {
    fireEvent.change(screen.getByPlaceholderText('Choose a new password'), { target: { value: password } });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('ResetPasswordPage', () => {
    it('leaves a valid link open and applies the policy that came with it', async () => {
        serve({
            '/auth/reset-token/a1b2c3': () =>
                ok(tokenStatus({ passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, min_length: 12 } })),
        });

        render(<ResetPasswordPage />);

        expect(await screen.findByText('At least 12 characters')).toBeInTheDocument();
        expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
    });

    it('says so on load when the link is no longer valid', async () => {
        serve({ '/auth/reset-token/a1b2c3': () => ok(tokenStatus({ valid: false, expired: true })) });

        render(<ResetPasswordPage />);

        expect(await screen.findByText(EXPIRED)).toBeInTheDocument();
    });

    it('does not call a link dead when it cannot read the check', async () => {
        // A 200 this page does not understand is no evidence the token is bad;
        // submitting is still the real test.
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

        render(<ResetPasswordPage />);
        await settle();

        expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument();
    });

    it('does not call a link dead when the check is unreachable', async () => {
        mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

        render(<ResetPasswordPage />);
        await settle();

        expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument();
    });

    it('sets the new password and confirms it', async () => {
        serve({
            '/auth/reset-token/a1b2c3': () => ok(tokenStatus()),
            '/auth/reset-password': () => ok({ message: 'Password updated successfully.' }),
        });

        render(<ResetPasswordPage />);
        await settle();
        await submitNewPassword('correct-horse-battery');

        expect(await screen.findByText('Password updated')).toBeInTheDocument();
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/auth/reset-password'),
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ token: 'a1b2c3', newPassword: 'correct-horse-battery' }),
            }),
        );
    });

    it("shows the server's reason when it rejects the new password", async () => {
        serve({
            '/auth/reset-token/a1b2c3': () => ok(tokenStatus()),
            '/auth/reset-password': () => rejected(400, 'Password must include a number.'),
        });

        render(<ResetPasswordPage />);
        await settle();
        await submitNewPassword('correct-horse-battery');

        expect(await screen.findByText('Password must include a number.')).toBeInTheDocument();
        expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument();
    });

    it('offers to resend an expired invite and confirms when it has gone out', async () => {
        serve({
            '/auth/reset-token/a1b2c3': () =>
                ok(tokenStatus({ valid: false, expired: true, purpose: 'REFEREE_INVITE', canResend: true })),
            '/auth/invite/resend': () => ok({ resent: true }),
        });

        render(<ResetPasswordPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Send me a new link' }));

        expect(await screen.findByText('Done. Check your email and your phone for a new link.')).toBeInTheDocument();
    });
});
