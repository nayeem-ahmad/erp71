import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

import SlaPage from './page';

describe('SlaPage', () => {
    it('renders the main SLA heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('Service Level Agreement')).toBeInTheDocument();
    });

    it('renders the last-updated date', () => {
        render(<SlaPage />);
        expect(screen.getByText('Last updated: May 2026')).toBeInTheDocument();
    });

    it('renders section 1 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('1. Service Availability')).toBeInTheDocument();
    });

    it('renders the 99.9% uptime commitment', () => {
        render(<SlaPage />);
        expect(screen.getByText('99.9%')).toBeInTheDocument();
    });

    it('renders section 2 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('2. Scheduled Maintenance')).toBeInTheDocument();
    });

    it('renders maintenance window details', () => {
        render(<SlaPage />);
        expect(screen.getByText(/Every Sunday/)).toBeInTheDocument();
        expect(screen.getByText(/02:00 – 04:00 BST/)).toBeInTheDocument();
    });

    it('renders section 3 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('3. Support Response Times')).toBeInTheDocument();
    });

    it('renders support priority levels', () => {
        render(<SlaPage />);
        expect(screen.getByText('Critical (P1)')).toBeInTheDocument();
        expect(screen.getByText('High (P2)')).toBeInTheDocument();
        expect(screen.getByText('Medium (P3)')).toBeInTheDocument();
        expect(screen.getByText('Low (P4)')).toBeInTheDocument();
    });

    it('renders support response time values', () => {
        render(<SlaPage />);
        // Multiple cells with these values
        expect(screen.getAllByText('2 hours').length).toBeGreaterThan(0);
        expect(screen.getAllByText('8 hours').length).toBeGreaterThan(0);
        expect(screen.getAllByText('24 hours').length).toBeGreaterThan(0);
        expect(screen.getAllByText('48 hours').length).toBeGreaterThan(0);
    });

    it('renders section 4 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('4. Incident Response Process')).toBeInTheDocument();
    });

    it('renders incident response steps', () => {
        render(<SlaPage />);
        expect(screen.getByText('Detection.')).toBeInTheDocument();
        expect(screen.getByText('On-call page.')).toBeInTheDocument();
        expect(screen.getByText('Status page update.')).toBeInTheDocument();
        expect(screen.getByText('Resolution.')).toBeInTheDocument();
        expect(screen.getByText('Post-mortem.')).toBeInTheDocument();
    });

    it('renders section 5 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('5. Exclusions')).toBeInTheDocument();
    });

    it('renders exclusion items', () => {
        render(<SlaPage />);
        expect(screen.getByText('Third-party payment services')).toBeInTheDocument();
        expect(screen.getByText('Infrastructure providers')).toBeInTheDocument();
        expect(screen.getByText('Customer-side issues')).toBeInTheDocument();
        expect(screen.getByText('Force majeure')).toBeInTheDocument();
    });

    it('renders section 6 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('6. SLA Credits')).toBeInTheDocument();
    });

    it('renders SLA credit table rows', () => {
        render(<SlaPage />);
        expect(screen.getByText('10% of monthly fee')).toBeInTheDocument();
        expect(screen.getByText('25% of monthly fee')).toBeInTheDocument();
        expect(screen.getByText('50% of monthly fee')).toBeInTheDocument();
    });

    it('renders section 7 heading', () => {
        render(<SlaPage />);
        expect(screen.getByText('7. Contact')).toBeInTheDocument();
    });

    it('renders contact details', () => {
        render(<SlaPage />);
        expect(screen.getByText('ERP71 Ltd.')).toBeInTheDocument();
        expect(screen.getByText('Dhaka, Bangladesh')).toBeInTheDocument();
    });

    it('renders support email links', () => {
        render(<SlaPage />);
        const emailLinks = screen.getAllByText('support@erp71.com');
        expect(emailLinks.length).toBeGreaterThan(0);
    });

    it('renders status page links', () => {
        render(<SlaPage />);
        const statusLinks = screen.getAllByText('status.erp71.com');
        expect(statusLinks.length).toBeGreaterThan(0);
    });

    it('renders the nav Sign in link', () => {
        render(<SlaPage />);
        const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
        expect(signInLinks.length).toBeGreaterThan(0);
    });

    it('renders the nav Start free trial link', () => {
        render(<SlaPage />);
        const trialLinks = screen.getAllByRole('link', { name: /start free trial/i });
        expect(trialLinks.length).toBeGreaterThan(0);
    });

    it('renders footer links', () => {
        render(<SlaPage />);
        expect(screen.getByText('Terms of Service')).toBeInTheDocument();
        expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
        expect(screen.getByText('Refund Policy')).toBeInTheDocument();
    });

    it('renders the copyright notice', () => {
        render(<SlaPage />);
        expect(screen.getByText(/ERP71\. All rights reserved\./)).toBeInTheDocument();
    });

    it('renders the 24 hours advance notice text for maintenance', () => {
        render(<SlaPage />);
        expect(screen.getByText(/24 hours' advance notice/)).toBeInTheDocument();
    });

    it('renders the 30 calendar days credit request deadline', () => {
        render(<SlaPage />);
        expect(screen.getByText(/30 calendar days/)).toBeInTheDocument();
    });
});
