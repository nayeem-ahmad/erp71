import React from 'react';
import { render, screen } from '@testing-library/react';

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

import HomePage from './page';

describe('HomePage', () => {
    it('renders the brand name in the nav', () => {
        render(<HomePage />);
        expect(screen.getAllByText('ERP71').length).toBeGreaterThan(0);
    });

    it('renders the hero tagline badge', () => {
        render(<HomePage />);
        expect(screen.getByText('Built for Bangladeshi retail businesses')).toBeInTheDocument();
    });

    it('renders the hero heading', () => {
        render(<HomePage />);
        expect(screen.getByText('Run your store.')).toBeInTheDocument();
        expect(screen.getByText('Grow your business.')).toBeInTheDocument();
    });

    it('renders the dashboard preview', () => {
        render(<HomePage />);
        expect(screen.getByText('Today sales')).toBeInTheDocument();
        expect(screen.getByText('Recent sales')).toBeInTheDocument();
    });

    it('renders the how-it-works section', () => {
        render(<HomePage />);
        expect(screen.getByText('Up and running in one afternoon')).toBeInTheDocument();
        expect(screen.getByText('Create your workspace')).toBeInTheDocument();
        expect(screen.getByText('Sell from POS')).toBeInTheDocument();
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

    it('renders payment methods', () => {
        render(<HomePage />);
        expect(screen.getByText('Payments your customers already use')).toBeInTheDocument();
        expect(screen.getByText('bKash')).toBeInTheDocument();
        expect(screen.getByText('Nagad')).toBeInTheDocument();
    });

    it('renders the stats section', () => {
        render(<HomePage />);
        expect(screen.getByText('500+')).toBeInTheDocument();
        expect(screen.getByText('Active stores')).toBeInTheDocument();
    });

    it('renders testimonials', () => {
        render(<HomePage />);
        expect(screen.getByText('Trusted by retailers across Bangladesh')).toBeInTheDocument();
        expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    });

    it('renders all four plan tiers in the pricing preview', () => {
        render(<HomePage />);
        expect(screen.getAllByText('FREE').length).toBeGreaterThan(0);
        expect(screen.getAllByText('BASIC').length).toBeGreaterThan(0);
        expect(screen.getAllByText('STANDARD').length).toBeGreaterThan(0);
        expect(screen.getAllByText('PREMIUM').length).toBeGreaterThan(0);
    });

    it('renders plan prices aligned with backend seed', () => {
        render(<HomePage />);
        expect(screen.getByText('Free')).toBeInTheDocument();
        expect(screen.getByText('৳499')).toBeInTheDocument();
        expect(screen.getByText('৳999')).toBeInTheDocument();
        expect(screen.getByText('৳1,499')).toBeInTheDocument();
    });

    it('renders the "See full pricing" link', () => {
        render(<HomePage />);
        expect(screen.getByText(/See full pricing & feature comparison/)).toBeInTheDocument();
    });

    it('renders the CTA section', () => {
        render(<HomePage />);
        expect(screen.getByText('Ready to modernise your store?')).toBeInTheDocument();
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