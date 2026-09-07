import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

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

const getSubscriptionPlans = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getSubscriptionPlans: (...args: unknown[]) => getSubscriptionPlans(...args),
    },
}));

import HomePage from './HomeClient';

beforeEach(() => {
    getSubscriptionPlans.mockReset();
    // Mirrors production: three plans, PREMIUM omitted while it is coming soon.
    getSubscriptionPlans.mockResolvedValue([
        { code: 'BASIC', name: 'Starter', description: 'Live starter tagline', monthly_price: 299, yearly_price: 2990, setup_fee: 0 },
        { code: 'ACCOUNTING', name: 'Accounting', description: 'Live accounting tagline', monthly_price: 749, yearly_price: 7490, setup_fee: 0 },
        { code: 'STANDARD', name: 'Growth', description: 'Live growth tagline', monthly_price: 999, yearly_price: 9990, setup_fee: 4000 },
    ]);
});

describe('HomePage', () => {
    it('renders the brand mark in the nav', () => {
        render(<HomePage />);
        // The wordmark is the logo artwork now, labelled with the brand name.
        expect(screen.getAllByAltText('ERP71').length).toBeGreaterThan(0);
    });

    it('renders the hero tagline badge', () => {
        render(<HomePage />);
        expect(screen.getByText('Built for small businesses')).toBeInTheDocument();
    });

    it('renders the hero heading', () => {
        render(<HomePage />);
        expect(screen.getByText('Run your business.')).toBeInTheDocument();
        expect(screen.getByText('Grow with confidence.')).toBeInTheDocument();
    });

    it('renders the dashboard preview as a real screenshot', () => {
        // The preview used to be a hand-built mock that drifted from the app;
        // it is now a screenshot of the actual dashboard.
        render(<HomePage />);
        const shot = screen.getByRole('img', { name: /ERP71 dashboard/i });
        expect(shot).toHaveAttribute('src', expect.stringContaining('dashboard-preview'));
    });

    it('renders the how-it-works section', () => {
        render(<HomePage />);
        expect(screen.getByText('Up and running in one afternoon')).toBeInTheDocument();
        expect(screen.getByText('Create your workspace')).toBeInTheDocument();
        expect(screen.getByText('Start selling')).toBeInTheDocument();
    });

    it('renders all six feature titles', () => {
        render(<HomePage />);
        expect(screen.getByText('Point of Sale')).toBeInTheDocument();
        expect(screen.getByText('Inventory Control')).toBeInTheDocument();
        expect(screen.getByText('Sales Analytics')).toBeInTheDocument();
        expect(screen.getByText('Customer Management')).toBeInTheDocument();
        expect(screen.getByText('Integrated Payments')).toBeInTheDocument();
        expect(screen.getByText('Multi-Tenant SaaS')).toBeInTheDocument();
    });

    it('renders module showcase', () => {
        render(<HomePage />);
        expect(screen.getByText('Modules that scale with you')).toBeInTheDocument();
        expect(screen.getByText('POS & Checkout')).toBeInTheDocument();
        expect(screen.getAllByText('Accounting').length).toBeGreaterThan(0);
        expect(screen.getByText('Online Storefront')).toBeInTheDocument();
    });

    it('renders payment methods, generic ones first', () => {
        render(<HomePage />);
        expect(screen.getByText('Take payment however your customers pay')).toBeInTheDocument();
        expect(screen.getByText('Cash')).toBeInTheDocument();
        expect(screen.getByText('Cards')).toBeInTheDocument();
        // The regional gateways are still supported, just no longer the headline.
        expect(screen.getByText('bKash')).toBeInTheDocument();
    });

    it('renders capabilities rather than invented traction numbers', () => {
        // We are pre-launch: the band claims what the product does, not how
        // many businesses use it.
        render(<HomePage />);
        expect(screen.getByText('What you get on day one')).toBeInTheDocument();
        expect(screen.getByText('Double-entry')).toBeInTheDocument();
        expect(screen.queryByText('500+')).not.toBeInTheDocument();
        expect(screen.queryByText(/Sales processed daily/)).not.toBeInTheDocument();
    });

    it('renders use cases in place of invented testimonials', () => {
        render(<HomePage />);
        expect(screen.getByText('Built for how you actually work')).toBeInTheDocument();
        expect(screen.getByText('Retail & POS')).toBeInTheDocument();
        expect(screen.queryByText('Rahim Uddin')).not.toBeInTheDocument();
    });

    it('renders the ladder tiers in the pricing preview', async () => {
        render(<HomePage />);
        await waitFor(() => expect(screen.getAllByText('Starter').length).toBeGreaterThan(0));
        expect(screen.getAllByText('Growth').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Business').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Enterprise').length).toBeGreaterThan(0);
    });

    it('shows the same live prices the pricing page does', async () => {
        // The preview used to map the static constants, so it froze at the
        // hardcoded numbers while /pricing followed the API.
        render(<HomePage />);
        await waitFor(() => expect(screen.getByText('Live starter tagline')).toBeInTheDocument());
        expect(screen.getByText('Live growth tagline')).toBeInTheDocument();
    });

    it('sends Enterprise to sales rather than checkout', () => {
        render(<HomePage />);
        expect(screen.getByText('Talk to sales')).toBeInTheDocument();
    });

    it('offers Business rather than badging it coming soon', () => {
        // It was previewed as coming-soon until it opened for self-serve on
        // 2026-09-07.
        render(<HomePage />);
        expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
        expect(screen.getByText('Business')).toBeInTheDocument();
    });

    it('renders plan prices from the live plans endpoint', async () => {
        render(<HomePage />);
        await waitFor(() => expect(screen.getByText('৳ 299')).toBeInTheDocument());
        expect(screen.getByText('৳ 999')).toBeInTheDocument();
        // Business keeps its static price while the API omits it; Enterprise is
        // quote-led. The accounting edition is off the ladder and not previewed
        // here — it has its own block on /pricing.
        expect(screen.getByText('৳ 2,499')).toBeInTheDocument();
        expect(screen.getByText('Quote')).toBeInTheDocument();
    });

    it('renders the "See full pricing" link', () => {
        render(<HomePage />);
        expect(screen.getByText(/See full pricing & feature comparison/)).toBeInTheDocument();
    });

    it('renders the CTA section', () => {
        render(<HomePage />);
        expect(screen.getByText('Ready to modernise your business?')).toBeInTheDocument();
    });

    it('renders the footer links', () => {
        render(<HomePage />);
        expect(screen.getByText('Terms of Service')).toBeInTheDocument();
        expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
        expect(screen.getAllByText('Contact').length).toBeGreaterThan(0);
    });

    it('nav Sign in link points to /login', () => {
        render(<HomePage />);
        const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
        expect(signInLinks[0]).toHaveAttribute('href', '/login');
    });
});