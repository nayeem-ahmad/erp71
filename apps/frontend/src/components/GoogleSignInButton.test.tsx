import { render, screen, waitFor } from '@testing-library/react';
import GoogleSignInButton from './GoogleSignInButton';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getGoogleAuthConfig: jest.fn() },
}));

const getGoogleAuthConfig = api.getGoogleAuthConfig as jest.Mock;

/** Stands in for the Google Identity Services script that jsdom can't load. */
function installFakeGsi() {
    const initialize = jest.fn();
    const renderButton = jest.fn((parent: HTMLElement) => {
        const button = document.createElement('div');
        button.textContent = 'Sign in with Google';
        parent.appendChild(button);
    });
    (window as any).google = { accounts: { id: { initialize, renderButton } } };
    return { initialize, renderButton };
}

describe('GoogleSignInButton', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // The component memoizes the script load for the page's lifetime, so the
        // stub has to be in place before every test rather than injected on the
        // one render that happens to trigger the <script> insertion.
        installFakeGsi();
        // jsdom never fires load/error for a real <script src>, so resolve it here.
        jest.spyOn(document.head, 'appendChild').mockImplementation(((node: any) => {
            if (node?.tagName === 'SCRIPT') queueMicrotask(() => node.onload?.());
            return node;
        }) as any);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('renders nothing when the backend has no Google client id configured', async () => {
        getGoogleAuthConfig.mockResolvedValue({ enabled: false, client_id: null });
        const onAvailabilityChange = jest.fn();

        render(<GoogleSignInButton onCredential={jest.fn()} onAvailabilityChange={onAvailabilityChange} />);

        await waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));
        expect(screen.queryByText('Sign in with Google')).not.toBeInTheDocument();
        expect(document.head.appendChild).not.toHaveBeenCalled();
    });

    it('stays silent when the config request fails outright', async () => {
        getGoogleAuthConfig.mockRejectedValue(new Error('backend down'));
        const onAvailabilityChange = jest.fn();
        const onError = jest.fn();

        render(
            <GoogleSignInButton
                onCredential={jest.fn()}
                onError={onError}
                onAvailabilityChange={onAvailabilityChange}
            />,
        );

        // A backend that can't answer must not put an error banner on the login
        // form — password sign-in still works.
        await waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));
        expect(onError).not.toHaveBeenCalled();
    });

    it('renders Google\'s button and forwards the credential to the caller', async () => {
        getGoogleAuthConfig.mockResolvedValue({ enabled: true, client_id: 'erp71.apps.googleusercontent.com' });
        const onCredential = jest.fn();

        render(<GoogleSignInButton onCredential={onCredential} text="signup_with" />);

        await screen.findByText('Sign in with Google');

        const { initialize, renderButton } = (window as any).google.accounts.id;
        expect(initialize).toHaveBeenCalledWith(
            expect.objectContaining({
                client_id: 'erp71.apps.googleusercontent.com',
                // No silent re-auth: arriving on the page must not sign anyone in.
                auto_select: false,
            }),
        );
        expect(renderButton).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({ text: 'signup_with' }),
        );

        initialize.mock.calls[0][0].callback({ credential: 'google-id-token' });
        expect(onCredential).toHaveBeenCalledWith('google-id-token');
    });

    it('reports a cancelled sign-in instead of posting an empty credential', async () => {
        getGoogleAuthConfig.mockResolvedValue({ enabled: true, client_id: 'erp71.apps.googleusercontent.com' });
        const onCredential = jest.fn();
        const onError = jest.fn();

        render(<GoogleSignInButton onCredential={onCredential} onError={onError} />);
        await screen.findByText('Sign in with Google');

        (window as any).google.accounts.id.initialize.mock.calls[0][0].callback({});

        expect(onCredential).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
    });
});
