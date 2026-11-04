'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadGenerationPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        searchLeadGeneration: jest.fn(),
        importLeadGeneration: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast');

const ACME = {
    company_name: 'Acme Soft',
    website_url: 'https://acmesoft.com',
    linkedin_url: null,
    email: null,
    location: 'Dhaka',
    description: 'Custom ERP for SMEs',
    fit_score: 88,
    fit_reason: 'Builds B2B SaaS for retailers',
    source_url: 'https://acmesoft.com',
    unverified: false,
    existing_lead_id: null,
    existing_lead_name: null,
};

describe('LeadGenerationPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.searchLeadGeneration.mockResolvedValue({
            query: 'B2B companies',
            web_search: true,
            credits_used: 3,
            candidates: [ACME],
        });
        api.importLeadGeneration.mockResolvedValue({
            created: [{ id: 'lead-1', name: 'Acme Soft' }],
            skipped: [],
            failed: [],
        });
    });

    it('starts with a B2B niche the tenant can edit, defaulting to SMEs in Bangladesh', () => {
        render(<LeadGenerationPage />);
        expect(screen.getByLabelText(/who you sell to/i)).toHaveValue(
            'small and medium businesses',
        );
        expect(screen.getByLabelText(/location/i)).toHaveValue('Bangladesh');
    });

    it('sends the brief to search and shows the companies that came back', async () => {
        render(<LeadGenerationPage />);
        fireEvent.click(screen.getByRole('button', { name: /find companies/i }));

        await screen.findByText('Acme Soft');
        expect(api.searchLeadGeneration).toHaveBeenCalledWith(
            expect.objectContaining({
                niche: 'small and medium businesses',
                location: 'Bangladesh',
            }),
        );
        expect(screen.getByText(/builds b2b saas for retailers/i)).toBeInTheDocument();
    });

    it('adds the selected company as a lead and links to it', async () => {
        render(<LeadGenerationPage />);
        fireEvent.click(screen.getByRole('button', { name: /find companies/i }));
        await screen.findByText('Acme Soft');

        fireEvent.click(screen.getByRole('checkbox', { name: /acme soft/i }));
        fireEvent.click(screen.getByRole('button', { name: /add selected as leads/i }));

        await waitFor(() => expect(api.importLeadGeneration).toHaveBeenCalled());
        expect(api.importLeadGeneration.mock.calls[0][0][0].company_name).toBe('Acme Soft');
        expect(toast.success).toHaveBeenCalled();
        expect(screen.getByRole('link', { name: /open lead/i })).toHaveAttribute('href', '/crm/leads/lead-1');
    });

    it('does not offer a company that is already a lead', async () => {
        api.searchLeadGeneration.mockResolvedValue({
            query: 'B2B companies',
            web_search: true,
            credits_used: 1,
            candidates: [{ ...ACME, existing_lead_id: 'lead-old', existing_lead_name: 'Acme Soft Ltd' }],
        });

        render(<LeadGenerationPage />);
        fireEvent.click(screen.getByRole('button', { name: /find companies/i }));
        await screen.findByText(/already in crm/i);

        expect(screen.queryByRole('checkbox', { name: /acme soft/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /acme soft ltd/i })).toHaveAttribute(
            'href',
            '/crm/leads/lead-old',
        );
    });
});
