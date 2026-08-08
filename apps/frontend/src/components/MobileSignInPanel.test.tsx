import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MobileSignInPanel from './MobileSignInPanel';
import { api } from '@/lib/api';
import { sendPhoneVerificationCode } from '@/lib/firebase-phone-auth';

jest.mock('@/lib/api', () => ({
    api: { getFirebaseAuthConfig: jest.fn(), mobileSignIn: jest.fn() },
}));

jest.mock('@/lib/firebase-phone-auth', () => ({
    sendPhoneVerificationCode: jest.fn(),
    describeFirebaseAuthError: (error: any, fallback: string) => error?.message || fallback,
}));

const getFirebaseAuthConfig = api.getFirebaseAuthConfig as jest.Mock;
const mobileSignIn = api.mobileSignIn as jest.Mock;
const sendCode = sendPhoneVerificationCode as jest.Mock;

const CONFIG = {
    enabled: true,
    api_key: 'AIzaSyTestKey',
    auth_domain: 'erp71.firebaseapp.com',
    project_id: 'erp71',
};

const confirm = jest.fn();

/** Drives the panel from the collapsed button to a verified Firebase token. */
async function verifyNumber(code = '123456') {
    fireEvent.click(await screen.findByRole('button', { name: /sign in with mobile number/i }));
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    const codeInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(codeInput, { target: { value: code } });
    // Wrapped in an async act because submitting runs an async handler: the
    // state updates that follow the awaited confirm() land after the click.
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));
    });
}

describe('MobileSignInPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getFirebaseAuthConfig.mockResolvedValue(CONFIG);
        confirm.mockResolvedValue('firebase-id-token');
        sendCode.mockResolvedValue({ confirm, dispose: jest.fn() });
        mobileSignIn.mockResolvedValue({ access_token: 'x' });
    });

    it('renders nothing when the backend has no Firebase project configured', async () => {
        getFirebaseAuthConfig.mockResolvedValue({ enabled: false });
        const onAvailabilityChange = jest.fn();

        render(<MobileSignInPanel onSuccess={jest.fn()} onAvailabilityChange={onAvailabilityChange} />);

        await waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));
        expect(screen.queryByRole('button', { name: /mobile number/i })).not.toBeInTheDocument();
    });

    it('stays silent when the config request fails outright', async () => {
        getFirebaseAuthConfig.mockRejectedValue(new Error('backend down'));
        const onAvailabilityChange = jest.fn();
        const onError = jest.fn();

        render(
            <MobileSignInPanel onSuccess={jest.fn()} onError={onError} onAvailabilityChange={onAvailabilityChange} />,
        );

        // A backend that can't answer must not put an error banner on the login
        // form — password sign-in still works.
        await waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));
        expect(onError).not.toHaveBeenCalled();
    });

    it('sends a code to the E.164 number and exchanges the token for a session', async () => {
        const onSuccess = jest.fn();
        render(<MobileSignInPanel onSuccess={onSuccess} />);

        await verifyNumber();

        expect(sendCode).toHaveBeenCalledWith(
            expect.objectContaining({ project_id: 'erp71' }),
            '+8801712345678',
            expect.any(HTMLElement),
        );
        expect(confirm).toHaveBeenCalledWith('123456');
        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ access_token: 'x' }));
        expect(mobileSignIn).toHaveBeenCalledWith({ idToken: 'firebase-id-token' });
    });

    it('rejects an unusable number before asking Firebase for an SMS', async () => {
        const onError = jest.fn();
        render(<MobileSignInPanel onSuccess={jest.fn()} onError={onError} />);

        fireEvent.click(await screen.findByRole('button', { name: /sign in with mobile number/i }));
        fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: /send code/i }));

        await waitFor(() => expect(onError).toHaveBeenCalledWith('Please enter a valid mobile number.'));
        expect(sendCode).not.toHaveBeenCalled();
    });

    it('collects an email when the verified number belongs to no account yet', async () => {
        const onSuccess = jest.fn();
        mobileSignIn
            .mockResolvedValueOnce({ requires_signup: true, mobile: '+8801712345678' })
            .mockResolvedValueOnce({ access_token: 'x', is_new_user: true });

        render(<MobileSignInPanel onSuccess={onSuccess} />);
        await verifyNumber();

        const emailInput = await screen.findByLabelText(/email address/i);
        expect(onSuccess).not.toHaveBeenCalled();
        fireEvent.change(emailInput, { target: { value: 'owner@shop.com' } });
        fireEvent.click(screen.getByRole('button', { name: /create account/i }));

        // The same Firebase token is reused, so no second SMS is sent.
        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
        expect(mobileSignIn).toHaveBeenLastCalledWith({
            idToken: 'firebase-id-token',
            email: 'owner@shop.com',
            name: undefined,
        });
        expect(sendCode).toHaveBeenCalledTimes(1);
    });

    it('carries the surrounding signup form into the exchange', async () => {
        render(
            <MobileSignInPanel
                onSuccess={jest.fn()}
                intent="signup"
                signUpFields={() => ({ email: 'owner@shop.com', tenantName: 'Dhaka Retail Co.', planCode: 'STANDARD' })}
            />,
        );

        fireEvent.click(await screen.findByRole('button', { name: /sign up with mobile number/i }));
        fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '01712345678' } });
        fireEvent.click(screen.getByRole('button', { name: /send code/i }));
        fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

        await waitFor(() => expect(mobileSignIn).toHaveBeenCalledWith({
            idToken: 'firebase-id-token',
            email: 'owner@shop.com',
            tenantName: 'Dhaka Retail Co.',
            planCode: 'STANDARD',
        }));
    });

    it('surfaces a wrong code without losing the flow', async () => {
        const onError = jest.fn();
        confirm.mockRejectedValue(Object.assign(new Error('bad code'), { code: 'auth/invalid-verification-code' }));

        render(<MobileSignInPanel onSuccess={jest.fn()} onError={onError} />);
        await verifyNumber('000000');

        expect(onError).toHaveBeenCalledWith('bad code');
        // Still on the code step with the button live again, so they can retype
        // the code rather than start over.
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /verify and continue/i })).toBeEnabled();
    });
});
