import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

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

jest.mock('@/lib/api', () => ({
    api: {
        getSubscriptionPlans: jest.fn().mockResolvedValue([
            { code: 'BASIC', name: 'BASIC', description: 'For small shops just getting started', monthly_price: 499, yearly_price: 4992 },
            { code: 'ACCOUNTING', name: 'ACCOUNTING', description: 'Bookkeeping-focused pack for accountants', monthly_price: 749, yearly_price: 7488 },
            { code: 'STANDARD', name: 'STANDARD', description: 'For growing businesses with multiple locations', monthly_price: 999, yearly_price: 9996 },
            { code: 'PREMIUM', name: 'PREMIUM', description: 'For enterprise retailers scaling fast', monthly_price: 1499, yearly_price: 14988 },
        ]),
    },
}));

import PricingPage from './page';

describe('PricingPage', () => {
    it('renders the main page heading', () => {
        render(<PricingPage />);
        expect(screen.getByText('Simple, transparent pricing')).toBeInTheDocument();
    });

    it('renders the hero subtitle', () => {
        render(<PricingPage />);
        expect(
            screen.getByText(/Built for Bangladeshi SMEs/),
        ).toBeInTheDocument();
    });

    it('renders paid plan names', () => {
        render(<PricingPage />);
        expect(screen.getAllByText('BASIC').length).toBeGreaterThan(0);
        expect(screen.getAllByText('ACCOUNTING').length).toBeGreaterThan(0);
        expect(screen.getAllByText('STANDARD').length).toBeGreaterThan(0);
        expect(screen.getAllByText('PREMIUM').length).toBeGreaterThan(0);
    });

    it('renders plan taglines', () => {
        render(<PricingPage />);
        expect(screen.getByText('For small shops just getting started')).toBeInTheDocument();
        expect(screen.getByText('For growing businesses with multiple locations')).toBeInTheDocument();
        expect(screen.getByText('For enterprise retailers scaling fast')).toBeInTheDocument();
    });

    it('shows "Most Popular" badge on the highlighted plan', () => {
        render(<PricingPage />);
        expect(screen.getByText('Most Popular')).toBeInTheDocument();
    });

    it('renders the Monthly and Yearly toggle labels', () => {
        render(<PricingPage />);
        expect(screen.getByText('Monthly')).toBeInTheDocument();
        expect(screen.getByText('Yearly')).toBeInTheDocument();
    });

    it('switches to yearly pricing when the toggle is clicked', () => {
        render(<PricingPage />);
        const toggle = screen.getByRole('button', { name: /toggle billing period/i });
        fireEvent.click(toggle);
        // After switching to yearly the "2 months free!" badge appears
        expect(screen.getByText('2 months free!')).toBeInTheDocument();
    });

    it('shows yearly savings percentages after toggling to yearly', () => {
        render(<PricingPage />);
        const toggle = screen.getByRole('button', { name: /toggle billing period/i });
        fireEvent.click(toggle);
        const savingsMessages = screen.getAllByText(/Save 17% vs monthly/);
        expect(savingsMessages.length).toBe(4);
    });

    it('renders monthly prices aligned with backend seed', () => {
        render(<PricingPage />);
        expect(screen.getByText('৳499')).toBeInTheDocument();
        expect(screen.getByText('৳749')).toBeInTheDocument();
        expect(screen.getByText('৳999')).toBeInTheDocument();
        expect(screen.getByText('৳1,499')).toBeInTheDocument();
    });

    it('switches back to monthly when the toggle is clicked twice', () => {
        render(<PricingPage />);
        const toggle = screen.getByRole('button', { name: /toggle billing period/i });
        fireEvent.click(toggle);
        fireEvent.click(toggle);
        expect(screen.queryByText('2 months free!')).not.toBeInTheDocument();
    });

    it('renders paid-plan CTAs on every card', () => {
        render(<PricingPage />);
        expect(screen.getAllByText('Choose a plan').length).toBeGreaterThan(0);
    });

    it('renders the feature comparison table heading', () => {
        render(<PricingPage />);
        expect(screen.getByText('Compare plans in detail')).toBeInTheDocument();
    });

    it('renders feature comparison rows', () => {
        render(<PricingPage />);
        expect(screen.getAllByText('POS terminal').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Inventory management').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Accounting module').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Manufacturing / BOM').length).toBeGreaterThan(0);
    });

    it('renders the CTA strip', () => {
        render(<PricingPage />);
        expect(screen.getByText('Ready to modernise your business?')).toBeInTheDocument();
        expect(screen.getByText('Get started with STANDARD')).toBeInTheDocument();
    });

    it('renders the FAQ section heading', () => {
        render(<PricingPage />);
        expect(screen.getByText('Frequently asked questions')).toBeInTheDocument();
    });

    it('renders all FAQ question buttons', () => {
        render(<PricingPage />);
        expect(screen.getByText('Can I change my plan later?')).toBeInTheDocument();
        expect(screen.getByText('Is there a free trial?')).toBeInTheDocument();
        expect(screen.getByText('How does billing work?')).toBeInTheDocument();
        expect(screen.getByText('Do you offer refunds?')).toBeInTheDocument();
        expect(screen.getByText('What happens to my data if I cancel?')).toBeInTheDocument();
    });

    it('FAQ answer is hidden by default', () => {
        render(<PricingPage />);
        expect(
            screen.queryByText(/you can upgrade or downgrade at any time/i),
        ).not.toBeInTheDocument();
    });

    it('expands a FAQ item when its button is clicked', () => {
        render(<PricingPage />);
        const faqButton = screen.getByText('Can I change my plan later?');
        fireEvent.click(faqButton);
        expect(
            screen.getByText(/you can upgrade or downgrade at any time/i),
        ).toBeInTheDocument();
    });

    it('collapses an expanded FAQ item when its button is clicked again', () => {
        render(<PricingPage />);
        const faqButton = screen.getByText('Can I change my plan later?');
        fireEvent.click(faqButton);
        fireEvent.click(faqButton);
        expect(
            screen.queryByText(/you can upgrade or downgrade at any time/i),
        ).not.toBeInTheDocument();
    });

    it('can expand a different FAQ item independently', () => {
        render(<PricingPage />);
        const billingButton = screen.getByText('How does billing work?');
        fireEvent.click(billingButton);
        expect(screen.getByText(/bKash, Nagad, and all major credit\/debit cards/i)).toBeInTheDocument();
    });

    it('renders the "Still have questions?" contact link', () => {
        render(<PricingPage />);
        expect(screen.getByText('Contact support')).toBeInTheDocument();
    });

    it('renders the navigation links', () => {
        render(<PricingPage />);
        const links = screen.getAllByRole('link', { name: /sign in/i });
        expect(links.length).toBeGreaterThan(0);
    });

    it('renders the footer brand', () => {
        render(<PricingPage />);
        // ERP71 appears in both nav and footer
        expect(screen.getAllByText('ERP71').length).toBeGreaterThan(0);
    });

    it('renders the paid-plans-only note under plan cards', () => {
        render(<PricingPage />);
        expect(
            screen.getAllByText(/Paid plans only · Free trials and the free tier are temporarily unavailable/).length,
        ).toBeGreaterThan(0);
    });
});
