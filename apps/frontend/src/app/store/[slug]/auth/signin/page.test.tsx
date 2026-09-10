/**
 * Tests for the storefront customer sign-in page's Google and mobile buttons.
 *
 * What matters here is that both providers reach *this shop's* endpoints and
 * that their answers are routed exactly as the password form's are — a session
 * saved under the shop's own localStorage key, or the 2FA step. A provider that
 * silently posted to the ERP app's `/auth/*` would mint a workspace token for
 * someone who only meant to buy something.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorefrontSignInPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: () => ({ slug: 'dhaka-mart' }),
    useRouter: () => ({ push }),
}));

// Both are exercised through their props rather than their real widgets: the
// Google button is an iframe from accounts.google.com and the mobile panel puts
// a Firebase reCAPTCHA on the page, neither of which exists under jsdom. Their
// own suites cover the flows themselves.
jest.mock('@/components/GoogleSignInButton', () => ({
    __esModule: true,
    default: ({ onCredential, onAvailabilityChange }: any) => {
        // In an effect, as the real component does it: reporting availability
        // sets state on the page, which React forbids during another
        // component's render.
        require('react').useEffect(() => onAvailabilityChange?.(true), [onAvailabilityChange]);
        return (
            <button type="button" onClick={() => onCredential('google-id-token')}>
                Continue with Google
            </button>
        );
    },
}));

jest.mock('@/components/MobileSignInPanel', () => ({
    __esModule: true,
    default: ({ onSuccess, exchange, onError, onAvailabilityChange }: any) => {
        require('react').useEffect(() => onAvailabilityChange?.(true), [onAvailabilityChange]);
        // Mirrors the real panel: it awaits `exchange`, hands a session to
        // `onSuccess`, and routes a thrown error to `onError` for the page's
        // banner rather than swallowing it.
        const run = async () => {
            try {
                onSuccess(await exchange({ idToken: 'firebase-id-token' }));
            } catch (err: any) {
                onError?.(err.message);
            }
        };
        return (
            <button type="button" onClick={() => void run()}>
                Continue with mobile
            </button>
        );
    },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** The storefront lookup every render fires to put the shop's name in the header. */
function storefrontLookup() {
    return Promise.resolve({ ok: true, json: async () => ({ tenant: { name: 'Dhaka Mart' } }) } as Response);
}

function okJson(body: unknown) {
    return Promise.resolve({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockFetch.mockReturnValue(storefrontLookup());
});

/** The endpoint of the last non-lookup call, so a wrong host or path fails loudly. */
function lastRequest() {
    const calls = mockFetch.mock.calls.filter(([url]) => !String(url).endsWith('/storefront/dhaka-mart'));
    return { url: String(calls.at(-1)?.[0]), body: JSON.parse(calls.at(-1)?.[1]?.body ?? '{}') };
}

describe('StorefrontSignInPage — Google', () => {
    it('exchanges the credential at this shop and stores the shopper session', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/google')
                ? okJson({ access_token: 'shop-token', customer: { id: 'cust-1', name: 'Alice' } })
                : storefrontLookup(),
        );

        render(<StorefrontSignInPage />);
        fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/store/dhaka-mart'));
        const { url, body } = lastRequest();
        expect(url).toContain('/storefront/dhaka-mart/auth/google');
        expect(body).toEqual({ credential: 'google-id-token' });
        expect(JSON.parse(localStorage.getItem('storefront_customer_dhaka-mart')!)).toEqual({
            access_token: 'shop-token',
            customer: { id: 'cust-1', name: 'Alice' },
        });
    });

    it('collects the second factor instead of a session when the account has one', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/google') ? okJson({ requires_2fa: true, user_id: 'user-1' }) : storefrontLookup(),
        );

        render(<StorefrontSignInPage />);
        fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

        expect(await screen.findByLabelText(/authentication code/i)).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
        expect(localStorage.getItem('storefront_customer_dhaka-mart')).toBeNull();
    });

    it('shows the backend\'s reason rather than signing anyone in', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/google')
                ? Promise.resolve({
                      ok: false,
                      json: async () => ({ message: 'This email is already linked to a different Google account.' }),
                  } as Response)
                : storefrontLookup(),
        );

        render(<StorefrontSignInPage />);
        fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

        expect(
            await screen.findByText('This email is already linked to a different Google account.'),
        ).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
    });
});

describe('StorefrontSignInPage — mobile', () => {
    it('exchanges the Firebase token at this shop and stores the shopper session', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/mobile')
                ? okJson({ access_token: 'shop-token', customer: { id: 'cust-1', name: 'Alice' } })
                : storefrontLookup(),
        );

        render(<StorefrontSignInPage />);
        fireEvent.click(await screen.findByRole('button', { name: /continue with mobile/i }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/store/dhaka-mart'));
        const { url, body } = lastRequest();
        expect(url).toContain('/storefront/dhaka-mart/auth/mobile');
        expect(body).toEqual({ idToken: 'firebase-id-token' });
    });

    it('throws out of the exchange on a rejected token, so the panel can report it', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/mobile')
                ? Promise.resolve({ ok: false, json: async () => ({ message: 'That code has expired.' }) } as Response)
                : storefrontLookup(),
        );

        render(<StorefrontSignInPage />);
        fireEvent.click(await screen.findByRole('button', { name: /continue with mobile/i }));

        // A failure that resolved instead of throwing would leave the panel
        // treating an error body as a session — nobody signed in, nothing said.
        expect(await screen.findByText('That code has expired.')).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
        expect(localStorage.getItem('storefront_customer_dhaka-mart')).toBeNull();
    });
});
