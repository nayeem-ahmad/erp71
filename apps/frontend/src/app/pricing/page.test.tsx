import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

/**
 * Deliberately unlike the static fallback: different names, a different Starter
 * price, and a setup fee. The page is supposed to prefer these, and the old
 * suite could not tell the difference because its mock echoed the constants
 * back. `PREMIUM` is absent exactly as production omits it while it sits in
 * COMING_SOON_SUBSCRIPTION_PLAN_CODES.
 */
const API_PLANS = [
    {
        code: 'BASIC',
        name: 'Starter',
        description: 'Live starter tagline',
        monthly_price: 349,
        yearly_price: 3492,
        setup_fee: 0,
        features_json: { aiCreditsMonthly: 120 },
        marketing_features: ['Live starter bullet'],
    },
    {
        code: 'ACCOUNTING',
        name: 'Accounting edition',
        description: 'Live accounting tagline',
        monthly_price: 749,
        yearly_price: 7488,
        setup_fee: 0,
        marketing_features: ['Live accounting bullet'],
    },
    {
        code: 'STANDARD',
        name: 'Growth',
        description: 'Live growth tagline',
        monthly_price: 999,
        yearly_price: 9996,
        setup_fee: 4000,
        features_json: { aiCreditsMonthly: 500 },
        marketing_features: ['Live growth bullet'],
    },
];

const getSubscriptionPlans = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getSubscriptionPlans: (...args: unknown[]) => getSubscriptionPlans(...args),
    },
}));

import PricingPage from './PricingClient';

beforeEach(() => {
    getSubscriptionPlans.mockReset();
    getSubscriptionPlans.mockResolvedValue(API_PLANS);
});

describe('PricingPage', () => {
    it('renders the main page heading', () => {
        render(<PricingPage />);
        expect(screen.getByText('Simple, transparent pricing')).toBeInTheDocument();
    });

    it('renders the hero subtitle', () => {
        render(<PricingPage />);
        expect(screen.getByText(/Built for Bangladeshi SMEs/)).toBeInTheDocument();
    });

    it('renders the four ladder tiers', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getAllByText('Starter').length).toBeGreaterThan(0));
        expect(screen.getAllByText('Growth').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Business').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Enterprise').length).toBeGreaterThan(0);
    });

    it('prefers live API values over the static fallback', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText('৳ 349')).toBeInTheDocument());
        expect(screen.getByText('Live starter tagline')).toBeInTheDocument();
        expect(screen.getByText('Live growth bullet')).toBeInTheDocument();
    });

    it('falls back to the static ladder when the API is unreachable', async () => {
        getSubscriptionPlans.mockRejectedValue(new Error('offline'));
        render(<PricingPage />);
        // The seeded Starter price, not the live one from the mock above.
        await waitFor(() => expect(screen.getByText('৳ 299')).toBeInTheDocument());
    });

    it('shows the setup fee only on plans that charge one', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText('৳ 4,000')).toBeInTheDocument());
        // Growth from the API, plus Business still on its static fallback because
        // the API omits it. Starter and Enterprise charge nothing and show nothing.
        expect(screen.getAllByText(/one-time setup/).length).toBe(2);
        expect(screen.getByText('৳ 15,000')).toBeInTheDocument();
    });

    it('hides the setup fee entirely when every plan charges zero', async () => {
        // PREMIUM included here, otherwise Business keeps the static fee and the
        // assertion passes for the wrong reason.
        getSubscriptionPlans.mockResolvedValue([
            ...API_PLANS,
            { code: 'PREMIUM', name: 'Business', monthly_price: 2499, yearly_price: 24990 },
        ].map((plan) => ({ ...plan, setup_fee: 0 })));
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText('Live growth tagline')).toBeInTheDocument());
        expect(screen.queryByText(/one-time setup/)).not.toBeInTheDocument();
    });

    it('renders the Monthly and Yearly toggle labels', () => {
        render(<PricingPage />);
        expect(screen.getByText('Monthly')).toBeInTheDocument();
        expect(screen.getByText('Yearly')).toBeInTheDocument();
    });

    it('switches to yearly pricing when the toggle is clicked', () => {
        render(<PricingPage />);
        fireEvent.click(screen.getByRole('button', { name: /toggle billing period/i }));
        expect(screen.getByText('2 months free')).toBeInTheDocument();
    });

    it('switches back to monthly when the toggle is clicked twice', () => {
        render(<PricingPage />);
        const toggle = screen.getByRole('button', { name: /toggle billing period/i });
        fireEvent.click(toggle);
        fireEvent.click(toggle);
        expect(screen.queryByText('2 months free')).not.toBeInTheDocument();
    });

    it('shows yearly savings on the plans that have a yearly price', () => {
        render(<PricingPage />);
        fireEvent.click(screen.getByRole('button', { name: /toggle billing period/i }));
        expect(screen.getAllByText(/^Save \d+%$/).length).toBeGreaterThan(0);
    });

    it('links each purchasable plan to signup with its own slug', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getAllByText('Choose a plan').length).toBeGreaterThan(0));
        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toContain('/signup?plan=starter');
        expect(hrefs).toContain('/signup?plan=growth');
    });

    it('sends Enterprise to sales rather than checkout', () => {
        render(<PricingPage />);
        expect(screen.getByText('Talk to sales')).toBeInTheDocument();
        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toContain('/contact');
        expect(hrefs).not.toContain('/signup?plan=enterprise');
    });

    it('marks Business as coming soon while the API omits it', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0));
        const businessSignupLinks = screen.getAllByRole('link').filter((link) =>
            link.getAttribute('href')?.includes('plan=business'),
        );
        expect(businessSignupLinks).toHaveLength(0);
    });

    it('clears the coming-soon flag once the API returns that plan', async () => {
        getSubscriptionPlans.mockResolvedValue([
            ...API_PLANS,
            {
                code: 'PREMIUM',
                name: 'Business',
                description: 'Live business tagline',
                monthly_price: 2499,
                yearly_price: 24990,
                setup_fee: 15000,
                marketing_features: ['Live business bullet'],
            },
        ]);
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText('Live business tagline')).toBeInTheDocument());
        const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(hrefs).toContain('/signup?plan=business');
    });

    it('renders the accounting edition as its own block, off the ladder', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText(/Accounting edition — ৳ 749/)).toBeInTheDocument());
        expect(screen.getByText('Choose the accounting edition')).toBeInTheDocument();
    });

    it('renders the AI and data-migration bands', () => {
        render(<PricingPage />);
        expect(screen.getByText('Every plan is AI-enabled')).toBeInTheDocument();
        expect(screen.getByText('Moving your data in is included')).toBeInTheDocument();
    });

    it('renders what is included on every plan', () => {
        render(<PricingPage />);
        expect(screen.getByText('On every plan, including the cheapest')).toBeInTheDocument();
        expect(screen.getByText('Free import of your existing data')).toBeInTheDocument();
    });

    it('renders the comparison heading and grouped rows', () => {
        render(<PricingPage />);
        expect(screen.getByText('Compare all plans')).toBeInTheDocument();
        expect(screen.getAllByText('Capacity').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Artificial intelligence').length).toBeGreaterThan(0);
        expect(screen.getAllByText('POS terminal & cashier sessions').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Seats used by customer or portal logins').length).toBeGreaterThan(0);
    });

    it('marks unbuilt features as in development rather than available', () => {
        render(<PricingPage />);
        expect(screen.getAllByText('In development').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Book publishing/).length).toBeGreaterThan(0);
    });

    it('points the closing CTA at the highlighted plan', async () => {
        render(<PricingPage />);
        await waitFor(() => expect(screen.getByText(/Get started with Growth/)).toBeInTheDocument());
    });

    it('renders the FAQ section heading', () => {
        render(<PricingPage />);
        expect(screen.getByText('Frequently asked questions')).toBeInTheDocument();
    });

    it('renders the FAQ questions including the new offering', () => {
        render(<PricingPage />);
        expect(screen.getByText('Can I change my plan later?')).toBeInTheDocument();
        expect(screen.getByText('Do I pay extra for the AI?')).toBeInTheDocument();
        expect(screen.getByText('Will you move my existing data in?')).toBeInTheDocument();
        expect(screen.getByText('Do staff accounts cost extra?')).toBeInTheDocument();
        expect(screen.getByText('What is the setup fee?')).toBeInTheDocument();
    });

    it('FAQ answer is hidden by default', () => {
        render(<PricingPage />);
        expect(screen.queryByText(/upgrade or downgrade at any time/i)).not.toBeInTheDocument();
    });

    it('expands a FAQ item when its button is clicked', () => {
        render(<PricingPage />);
        fireEvent.click(screen.getByText('Can I change my plan later?'));
        expect(screen.getByText(/upgrade or downgrade at any time/i)).toBeInTheDocument();
    });

    it('collapses an expanded FAQ item when its button is clicked again', () => {
        render(<PricingPage />);
        const faqButton = screen.getByText('Can I change my plan later?');
        fireEvent.click(faqButton);
        fireEvent.click(faqButton);
        expect(screen.queryByText(/upgrade or downgrade at any time/i)).not.toBeInTheDocument();
    });

    it('can expand a different FAQ item independently', () => {
        render(<PricingPage />);
        fireEvent.click(screen.getByText('Do I pay extra for the AI?'));
        expect(screen.getByText(/the POS keeps ringing up sales/i)).toBeInTheDocument();
    });

    it('renders the "Still have questions?" contact link', () => {
        render(<PricingPage />);
        expect(screen.getByText('Contact support')).toBeInTheDocument();
    });

    it('renders the navigation links', () => {
        render(<PricingPage />);
        expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
    });

    it('renders the footer brand', () => {
        render(<PricingPage />);
        expect(screen.getAllByAltText('ERP71').length).toBeGreaterThan(0);
    });

    it('renders the paid-plans-only note under plan cards', () => {
        render(<PricingPage />);
        expect(
            screen.getAllByText(/Paid plans only · Free trials and the free tier are temporarily unavailable/).length,
        ).toBeGreaterThan(0);
    });
});
