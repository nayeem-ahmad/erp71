/**
 * Tests for the storefront customer sign-up page's Google and mobile buttons.
 *
 * The sign-in page's suite covers the shared wiring (this shop's endpoints, the
 * session key, the 2FA hand-off). What is specific to sign-up is that the form
 * above the buttons is not wasted: Google carries no phone number of its own, so
 * whatever the shopper typed has to reach the shop's customer record, and the
 * mobile panel must not ask again for details already on screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorefrontSignUpPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: () => ({ slug: 'dhaka-mart' }),
    useRouter: () => ({ push }),
}));

// Stubs rather than the real widgets: the Google button is an accounts.google.com
// iframe and the panel mounts a Firebase reCAPTCHA, neither of which exists
// under jsdom. Their own suites cover the flows themselves.
jest.mock('@/components/GoogleSignInButton', () => ({
    __esModule: true,
    default: ({ onCredential, onAvailabilityChange }: any) => {
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
    default: ({ signUpFields, onAvailabilityChange }: any) => {
        require('react').useEffect(() => onAvailabilityChange?.(true), [onAvailabilityChange]);
        return (
            <button type="button" onClick={() => mockSignUpFields(signUpFields())}>
                Continue with mobile
            </button>
        );
    },
}));

const mockSignUpFields = jest.fn();

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** The storefront lookup every render fires to put the shop's name in the header. */
function storefrontLookup() {
    return Promise.resolve({ ok: true, json: async () => ({ tenant: { name: 'Dhaka Mart' } }) } as Response);
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockFetch.mockImplementation((url: string) =>
        url.endsWith('/auth/google')
            ? Promise.resolve({
                  ok: true,
                  json: async () => ({ access_token: 'shop-token', customer: { id: 'cust-1' } }),
              } as Response)
            : storefrontLookup(),
    );
});

function googleRequestBody() {
    const call = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/auth/google'));
    return JSON.parse(call?.[1]?.body ?? '{}');
}

describe('StorefrontSignUpPage', () => {
    it('carries the typed phone number into the Google sign-up', async () => {
        render(<StorefrontSignUpPage />);
        fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: ' 01712345678 ' } });
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/store/dhaka-mart'));
        // Trimmed, because a stray space would be stored on the shop's customer
        // record and then never match the number they dial.
        expect(googleRequestBody()).toEqual({ credential: 'google-id-token', phone: '01712345678' });
    });

    it('omits the phone entirely when the field is untouched', async () => {
        render(<StorefrontSignUpPage />);
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/store/dhaka-mart'));
        // Not `phone: ''` — an empty string is a value the backend would try to
        // store, and a blank number is worse than none.
        expect(googleRequestBody()).toEqual({ credential: 'google-id-token' });
    });

    it('hands the mobile panel what the form already knows', async () => {
        render(<StorefrontSignUpPage />);
        fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Rahman' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'alice@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: /continue with mobile/i }));

        // With both filled the panel skips its own account step entirely.
        expect(mockSignUpFields).toHaveBeenCalledWith({ email: 'alice@example.com', name: 'Alice Rahman' });
    });

    it('sends the shopper to the sign-in page when the account has a second factor', async () => {
        mockFetch.mockImplementation((url: string) =>
            url.endsWith('/auth/google')
                ? Promise.resolve({ ok: true, json: async () => ({ requires_2fa: true, user_id: 'user-1' }) } as Response)
                : storefrontLookup(),
        );

        render(<StorefrontSignUpPage />);
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/store/dhaka-mart/auth/signin'));
        expect(localStorage.getItem('storefront_customer_dhaka-mart')).toBeNull();
    });
});
