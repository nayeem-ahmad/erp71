import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HelpPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ is_platform_admin: false, tenants: [] }),
    },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/test',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

describe('HelpPage', () => {
    it('renders the Help Center heading', () => {
        render(<HelpPage />);
        expect(screen.getByRole('heading', { name: 'Help Center' })).toBeInTheDocument();
        expect(screen.getByText('Frequently asked questions and guides')).toBeInTheDocument();
    });

    it('renders quick link cards for all users', () => {
        render(<HelpPage />);
        expect(screen.getByText('Email Support')).toBeInTheDocument();
        expect(screen.getByText('Contact Us')).toBeInTheDocument();
        expect(screen.queryByText('System Status')).not.toBeInTheDocument();
    });

    it('shows the status quick link for platform admins', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getMe.mockResolvedValueOnce({ is_platform_admin: true, tenants: [] });
        render(<HelpPage />);
        await waitFor(() => expect(screen.getByText('System Status')).toBeInTheDocument());
    });

    it('renders all FAQ section titles', () => {
        render(<HelpPage />);
        expect(screen.getByText('Getting Started')).toBeInTheDocument();
        expect(screen.getByText('Point of Sale (POS)')).toBeInTheDocument();
        expect(screen.getByText('Inventory Management')).toBeInTheDocument();
        expect(screen.getByText('Accounting')).toBeInTheDocument();
        expect(screen.getByText('Billing & Subscription')).toBeInTheDocument();
        expect(screen.getByText('E-commerce Storefront')).toBeInTheDocument();
        expect(screen.getByText('Security & Account')).toBeInTheDocument();
    });

    it('renders Getting Started section open by default with FAQ questions', () => {
        render(<HelpPage />);
        expect(screen.getByText('How do I add my first product?')).toBeInTheDocument();
        expect(screen.getByText('How do I create a store and start selling?')).toBeInTheDocument();
    });

    it('does not show POS FAQs initially (section is closed)', () => {
        render(<HelpPage />);
        expect(screen.queryByText('How does the offline POS work?')).not.toBeInTheDocument();
    });

    it('clicking a closed section opens it and shows its FAQs', () => {
        render(<HelpPage />);
        const posButton = screen.getByText('Point of Sale (POS)').closest('button')!;
        fireEvent.click(posButton);
        expect(screen.getByText('How does the offline POS work?')).toBeInTheDocument();
        expect(screen.getByText('Can I accept multiple payment methods in one sale?')).toBeInTheDocument();
    });

    it('clicking an open section collapses it', () => {
        render(<HelpPage />);
        // Getting Started is open by default
        expect(screen.getByText('How do I add my first product?')).toBeInTheDocument();
        const gettingStartedButton = screen.getByText('Getting Started').closest('button')!;
        fireEvent.click(gettingStartedButton);
        expect(screen.queryByText('How do I add my first product?')).not.toBeInTheDocument();
    });

    it('clicking a FAQ question expands the answer', () => {
        render(<HelpPage />);
        // Getting Started section is open by default
        const faqButton = screen.getByText('How do I add my first product?').closest('button')!;
        // Answer should not be visible yet
        expect(screen.queryByText(/Go to Inventory → Products and click/)).not.toBeInTheDocument();
        fireEvent.click(faqButton);
        expect(screen.getByText(/Go to Inventory → Products and click/)).toBeInTheDocument();
    });

    it('clicking an expanded FAQ collapses it', () => {
        render(<HelpPage />);
        const faqButton = screen.getByText('How do I add my first product?').closest('button')!;
        fireEvent.click(faqButton);
        expect(screen.getByText(/Go to Inventory → Products and click/)).toBeInTheDocument();
        fireEvent.click(faqButton);
        expect(screen.queryByText(/Go to Inventory → Products and click/)).not.toBeInTheDocument();
    });

    it('can expand multiple FAQs in the same section', () => {
        render(<HelpPage />);
        const faq1 = screen.getByText('How do I add my first product?').closest('button')!;
        const faq2 = screen.getByText('How do I invite staff members?').closest('button')!;
        fireEvent.click(faq1);
        fireEvent.click(faq2);
        expect(screen.getByText(/Go to Inventory → Products and click/)).toBeInTheDocument();
        expect(screen.getByText(/Go to Settings → Users and click/)).toBeInTheDocument();
    });

    it('can open multiple sections simultaneously', () => {
        render(<HelpPage />);
        const posButton = screen.getByText('Point of Sale (POS)').closest('button')!;
        const accountingButton = screen.getByText('Accounting').closest('button')!;
        fireEvent.click(posButton);
        fireEvent.click(accountingButton);
        expect(screen.getByText('How does the offline POS work?')).toBeInTheDocument();
        expect(screen.getByText('How does double-entry accounting work in this system?')).toBeInTheDocument();
    });

    it('shows FAQ count badges', () => {
        render(<HelpPage />);
        // Getting Started has 4 FAQs — find the badge text "4"
        const badges = screen.getAllByText('4');
        expect(badges.length).toBeGreaterThan(0);
    });

    it('renders footer with support email link', () => {
        render(<HelpPage />);
        expect(screen.getByText('Contact our support team')).toBeInTheDocument();
    });

    it('opens Inventory Management section and expands a FAQ', () => {
        render(<HelpPage />);
        const invButton = screen.getByText('Inventory Management').closest('button')!;
        fireEvent.click(invButton);
        expect(screen.getByText('How do I track stock across multiple warehouses?')).toBeInTheDocument();
        const faqBtn = screen.getByText('How do I track stock across multiple warehouses?').closest('button')!;
        fireEvent.click(faqBtn);
        expect(screen.getByText(/Go to Inventory → Warehouses to set up/)).toBeInTheDocument();
    });

    it('opens Security & Account section and expands 2FA FAQ', () => {
        render(<HelpPage />);
        const secButton = screen.getByText('Security & Account').closest('button')!;
        fireEvent.click(secButton);
        const faqBtn = screen.getByText('How do I enable two-factor authentication (2FA)?').closest('button')!;
        fireEvent.click(faqBtn);
        expect(screen.getByText(/Go to Settings → Account → 2FA tab/)).toBeInTheDocument();
    });
});
