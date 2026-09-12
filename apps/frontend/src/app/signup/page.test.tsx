import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupPage from './page';
import { api } from '../../lib/api';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';

const pushMock = jest.fn();
// A stable object reference (like the real next/navigation ReadonlyURLSearchParams)
// so effects with `[searchParams]` deps don't re-fire on every render.
let currentSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => currentSearchParams,
}));

jest.mock('../../lib/api', () => ({
    api: {
        getSubscriptionPlans: jest.fn().mockResolvedValue([
            // `yearly_price` is the annual total, matching the wire shape of
            // `GET /auth/plans` — not the monthly equivalent `/pricing` derives.
            { code: 'BASIC', name: 'Starter', description: 'One counter', monthly_price: 299, yearly_price: 2990, setup_fee: 0 },
            { code: 'STANDARD', name: 'Growth', description: 'Growth plan', monthly_price: 999, yearly_price: 9990, setup_fee: 4000 },
            { code: 'PREMIUM', name: 'Business', description: 'Multi-branch', monthly_price: 2499, yearly_price: 24990, setup_fee: 15000 },
        ]),
        getSignupDefaults: jest.fn().mockResolvedValue({ defaultPlanCode: 'STANDARD' }),
        signup: jest.fn().mockResolvedValue({
            access_token: 'token-1',
            tenants: [{ id: 'tenant-1', stores: [{ id: 'store-1' }], subscription: { plan: { code: 'BASIC' } } }],
        }),
        // Google sign-up stays off in these tests; the button renders nothing.
        getGoogleAuthConfig: jest.fn().mockResolvedValue({ enabled: false, client_id: null }),
        googleSignIn: jest.fn(),
        // The referral field debounces a lookup 400ms after a keystroke. Unmocked
        // it would reach a real fetch once these tests start typing into it.
        validateReferralCode: jest.fn().mockResolvedValue({ valid: false }),
    },
}));

describe('SignupPage', () => {
    beforeEach(() => {
        localStorage.clear();
        pushMock.mockReset();
        currentSearchParams = new URLSearchParams();
        (api.signup as jest.Mock).mockClear();
        (api.getSignupDefaults as jest.Mock).mockClear().mockResolvedValue({ defaultPlanCode: 'STANDARD' });
        (api.getSubscriptionPlans as jest.Mock).mockClear();
    });

    it('submits with org name, email and password only', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.tenantName).toBe('Dhaka Retail Co.');
    });

    it('refuses a common password before it reaches the API', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        // Clears the eight-character bar and every character-class rule a form
        // would think to ask for, and is still the first guess anyone makes.
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Password123' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await screen.findByText(/does not meet all the requirements/i);
        expect(api.signup).not.toHaveBeenCalled();
    });

    it('shows the platform rules as a live checklist', async () => {
        render(<SignupPage />);
        expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
        expect(screen.getByText('Not a commonly used password')).toBeInTheDocument();
    });

    it('pre-selects the fetched default plan when no ?plan= param is present', async () => {
        render(<SignupPage />);

        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.planCode).toBe('STANDARD');
    });

    it('offers Business as a selectable tier', async () => {
        // It used to be filtered out as coming-soon, so it never reached the
        // picker at all. This is the front half of the change that opened it.
        render(<SignupPage />);
        const business = await screen.findByRole('radio', { name: /Business/ });
        expect(business).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(business);
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        expect((api.signup as jest.Mock).mock.calls[0][0].planCode).toBe('PREMIUM');
    });

    it('shows the agreement itself, not just a link to it', async () => {
        // The box has to contain what the checkbox agrees to — a clause from the
        // core terms and the addendum for the tier being bought.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        expect(screen.getByText(/Acceptance of Terms/)).toBeInTheDocument();
        expect(screen.getByText(/exclusive jurisdiction of the courts of Dhaka/)).toBeInTheDocument();
    });

    it('swaps the tier addendum in the box when the tier changes', async () => {
        // Only the selected tier's addendum belongs in the box: it is the one
        // forming part of this purchase. /terms still shows all of them.
        render(<SignupPage />);
        fireEvent.click(await screen.findByRole('radio', { name: /Business/ }));
        expect(screen.getByText(/statutory payroll compliance|payroll module calculates and records/i)).toBeInTheDocument();
        expect(screen.queryByText(/Starter licenses one workspace/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: /Starter/ }));
        expect(screen.getByText(/Starter licenses one workspace/)).toBeInTheDocument();
        expect(screen.queryByText(/payroll module calculates and records/i)).not.toBeInTheDocument();
    });

    it('drops the ticked consent when the tier changes', async () => {
        // Consent is per tier: the box shows the selected plan's addendum and the
        // acceptance is recorded with that plan_code. Ticking on Starter and then
        // switching to Business would otherwise record agreement to payroll and
        // API obligations, and a setup fee, that were never on screen.
        render(<SignupPage />);
        fireEvent.click(await screen.findByRole('radio', { name: /Starter/ }));
        fireEvent.click(screen.getByRole('checkbox'));
        expect(screen.getByRole('checkbox')).toBeChecked();

        fireEvent.click(screen.getByRole('radio', { name: /Business/ }));
        expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('keeps the consent when an unrelated field changes', async () => {
        // Only a tier change invalidates it — retyping an email must not silently
        // untick a box the person deliberately ticked.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('shows the whole agreement in the box, not just the tier addendum', async () => {
        // The /terms snapshot cannot guard this surface: it renders non-dense, so a
        // dense-only regression (a block kind skipped when dense) would pass there
        // and silently empty the box the checkbox actually sits under. Pin one
        // clause from each block shape instead.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });
        expect(screen.getByText(/Acceptance of Terms/)).toBeInTheDocument();            // plain paragraph
        expect(screen.getByText(/Maintaining the confidentiality/)).toBeInTheDocument(); // list item
        expect(screen.getByText(/Auto-renewal/)).toBeInTheDocument();                    // bold-led list item
        expect(screen.getByText(/exclusive jurisdiction of the courts of Dhaka/)).toBeInTheDocument();
        expect(screen.getByText(/For questions about these Terms/)).toBeInTheDocument();  // final section
        expect(screen.getAllByText(/Dhaka, Bangladesh/).length).toBeGreaterThan(0);       // contact card
    });

    it('never lets a link in the consent box discard the form', async () => {
        // The signup form keeps everything in component state and persists
        // nothing, so a same-tab navigation out of the box throws away the email,
        // password, organization, phone, referral code, plan choice and the tick.
        // /terms is unaffected — there, navigating in place is correct.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        const box = screen.getByRole('region', { name: /terms of service/i });
        const links = Array.from(box.querySelectorAll('a[href]'))
            .filter((a) => !a.getAttribute('href')!.startsWith('mailto:'));

        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        }
    });

    it('keeps the referral field behind a toggle', async () => {
        // Most people have no code, and an always-open field cost a full row on a
        // page that already runs several screens.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        expect(screen.queryByLabelText(/referral code/i)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /have a referral code/i }));
        expect(screen.getByLabelText(/referral code/i)).toBeInTheDocument();
    });

    it('opens the referral field itself when a code arrives by ?ref=', async () => {
        // An attributed visitor must see their code rather than hunt for it: the
        // discount it carries is the reason they followed the link.
        currentSearchParams = new URLSearchParams({ ref: 'PARTNER1' });
        render(<SignupPage />);

        const field = await screen.findByLabelText(/referral code/i);
        expect(field).toHaveValue('PARTNER1');
        expect(screen.queryByRole('button', { name: /have a referral code/i })).not.toBeInTheDocument();
    });

    it('still sends a referral code entered through the toggle', async () => {
        // The field is collapsed, not removed — attribution must still work.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });
        fireEvent.click(screen.getByRole('button', { name: /have a referral code/i }));
        fireEvent.change(screen.getByLabelText(/referral code/i), { target: { value: 'partner9' } });

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        expect((api.signup as jest.Mock).mock.calls[0][0].referralCode).toBe('PARTNER9');
    });

    it('shows the tagline only for the selected tier', async () => {
        // Decision-support for the tier under consideration, noise on the others.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        expect(screen.getByText('Growth plan')).toBeInTheDocument();
        expect(screen.queryByText('Multi-branch')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: /Business/ }));
        expect(screen.getByText('Multi-branch')).toBeInTheDocument();
        expect(screen.queryByText('Growth plan')).not.toBeInTheDocument();
    });

    it('refuses to submit until the terms checkbox is ticked', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        expect(await screen.findByText(/accept the terms of service/i)).toBeInTheDocument();
        expect(api.signup).not.toHaveBeenCalled();
    });

    it('sends the version of the terms that was on screen', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.acceptedTermsVersion).toBe(CURRENT_TERMS_VERSION);
    });

    it('points the terms link at the addendum for the selected tier', async () => {
        currentSearchParams = new URLSearchParams({ plan: 'basic' });
        render(<SignupPage />);

        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        const link = screen.getByRole('link', { name: /terms of service/i });
        expect(link).toHaveAttribute('href', '/terms?plan=starter#plan-terms-starter');
    });

    it('keeps the ?plan= override and does not let the async default overwrite it', async () => {
        currentSearchParams = new URLSearchParams({ plan: 'basic' });
        render(<SignupPage />);

        // Wait for the async default-plan effect to resolve so the race is actually exercised.
        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.planCode).toBe('BASIC');
    });

    it('shows the onboarding fee on a plan that has one, and none on a plan that does not', async () => {
        // The fee used to be invisible until the in-app billing page, which is
        // after the account already exists.
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        const growthRow = screen.getByRole('radio', { name: /Growth/ }).closest('label');
        const businessRow = screen.getByRole('radio', { name: /Business/ }).closest('label');
        const starterRow = screen.getByRole('radio', { name: /Starter/ }).closest('label');

        expect(growthRow).toHaveTextContent('৳ 4,000 one-time onboarding fee');
        expect(businessRow).toHaveTextContent('৳ 15,000 one-time onboarding fee');
        // Starter's setup_fee is 0 and is hidden rather than rendered as ৳0.
        expect(starterRow).not.toHaveTextContent('one-time onboarding fee');
    });

    it('totals the subscription and the onboarding fee in the summary', async () => {
        render(<SignupPage />);
        const business = await screen.findByRole('radio', { name: /Business/ });
        fireEvent.click(business);

        // Monthly: 2,499 + 15,000 one-time.
        expect(await screen.findByText('৳ 17,499')).toBeInTheDocument();
    });

    it('switches every price to the annual total when yearly is selected', async () => {
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        fireEvent.click(screen.getByRole('button', { name: /^Yearly$/i }));

        // The annual total, not the 833/mo equivalent the pricing page shows.
        const growthRow = screen.getByRole('radio', { name: /Growth/ }).closest('label');
        expect(growthRow).toHaveTextContent('৳ 9,990');
        expect(growthRow).toHaveTextContent('৳ 833 / month equivalent');

        const businessRow = screen.getByRole('radio', { name: /Business/ }).closest('label');
        expect(businessRow).toHaveTextContent('৳ 24,990');
    });

    it('sends the chosen billing cycle with the signup payload', async () => {
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        fireEvent.click(screen.getByRole('button', { name: /^Yearly$/i }));
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        expect((api.signup as jest.Mock).mock.calls[0][0].billingCycle).toBe('YEARLY');
    });

    it('honours ?cycle=yearly so the pricing page choice survives the click', async () => {
        currentSearchParams = new URLSearchParams('plan=business&cycle=yearly');
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Business/ });

        // Business at the annual total, arrived at without touching the toggle.
        const businessRow = screen.getByRole('radio', { name: /Business/ }).closest('label');
        expect(businessRow).toHaveTextContent('৳ 24,990');
    });

    it('defaults to monthly when no cycle is given', async () => {
        render(<SignupPage />);
        await screen.findByRole('radio', { name: /Growth/ });

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Dhaka-Shop-2026' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        expect((api.signup as jest.Mock).mock.calls[0][0].billingCycle).toBe('MONTHLY');
    });
});
