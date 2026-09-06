import React from 'react';
import { render, screen } from '@testing-library/react';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';
import { PLAN_TERMS_ADDENDA } from '@/lib/marketing/plan-terms';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

let currentSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
    useSearchParams: () => currentSearchParams,
}));

import TermsClient from './TermsClient';

describe('TermsClient', () => {
    beforeEach(() => {
        currentSearchParams = new URLSearchParams();
    });

    it('prints the version a stored acceptance is recorded against', () => {
        render(<TermsClient />);
        expect(screen.getByText(`v${CURRENT_TERMS_VERSION}`)).toBeInTheDocument();
    });

    it('renders every tier addendum, whatever tier the reader arrived on', () => {
        // The whole document is the agreement. Showing only the tier in the query
        // string would misrepresent what a reader is agreeing to.
        render(<TermsClient />);
        for (const addendum of PLAN_TERMS_ADDENDA) {
            expect(screen.getByText(addendum.name)).toBeInTheDocument();
        }
    });

    it('marks the tier the signup page linked from', () => {
        currentSearchParams = new URLSearchParams({ plan: 'standard' });
        render(<TermsClient />);
        expect(screen.getByText('The plan you are signing up for')).toBeInTheDocument();
        expect(screen.getByText('Growth').closest('div[id^="plan-terms-"]')).toHaveAttribute(
            'id',
            'plan-terms-growth',
        );
    });

    it('marks nothing when the plan is unknown', () => {
        currentSearchParams = new URLSearchParams({ plan: 'gold' });
        render(<TermsClient />);
        expect(screen.queryByText('The plan you are signing up for')).not.toBeInTheDocument();
    });

    it('says the Enterprise agreement prevails over these terms', () => {
        // The gap that prompted the addenda: Enterprise never passes through
        // self-serve signup, so the document has to name what governs instead.
        render(<TermsClient />);
        expect(screen.getByText(/the signed agreement prevails/i)).toBeInTheDocument();
    });
});
