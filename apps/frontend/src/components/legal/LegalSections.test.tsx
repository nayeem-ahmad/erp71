import React from 'react';
import { render, screen } from '@testing-library/react';
import LegalSections from './LegalSections';
import { TERMS_SECTIONS, PLAN_ADDENDA_SECTION_NUMBER } from '@/lib/legal/terms-content';
import { PLAN_TERMS_ADDENDA, planTermsAddendumForCode } from '@/lib/marketing/plan-terms';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

describe('LegalSections', () => {
    it('numbers sections by position, including the generated one', () => {
        // Numbering is positional so the plan-addenda section cannot drift from
        // the cross-references in the prose ("set out in Section 11").
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} />);
        expect(screen.getByText('1. Acceptance of Terms')).toBeInTheDocument();
        expect(screen.getByText(`${PLAN_ADDENDA_SECTION_NUMBER}. Plan-Specific Terms`)).toBeInTheDocument();
        expect(screen.getByText(`${TERMS_SECTIONS.length}. Contact`)).toBeInTheDocument();
    });

    it('matches the section number the prose cross-references', () => {
        // §4 tells the reader the tier terms are "in Section 11". If the addenda
        // slot moves, that sentence silently starts lying.
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} />);
        expect(screen.getByRole('link', { name: 'Section 11' })).toBeInTheDocument();
        expect(PLAN_ADDENDA_SECTION_NUMBER).toBe(11);
    });

    it('leaves a same-document link bare when it is already on the page', () => {
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} />);
        expect(screen.getByRole('link', { name: 'Section 11' })).toHaveAttribute('href', '#plan-terms');
    });

    it('resolves a same-document link against linkBase when embedded elsewhere', () => {
        // In the signup box a bare '#plan-terms' would scroll the signup page
        // hunting for an anchor it does not have.
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} linkBase="/terms" />);
        expect(screen.getByRole('link', { name: 'Section 11' })).toHaveAttribute('href', '/terms#plan-terms');
    });

    it('leaves ordinary links alone whatever the linkBase', () => {
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} linkBase="/terms" />);
        for (const link of screen.getAllByRole('link', { name: 'Privacy Policy' })) {
            expect(link).toHaveAttribute('href', '/privacy');
        }
    });

    it('renders a mailto for an email node', () => {
        render(<LegalSections sections={TERMS_SECTIONS} addenda={PLAN_TERMS_ADDENDA} />);
        const [email] = screen.getAllByRole('link', { name: /@/ });
        expect(email.getAttribute('href')).toMatch(/^mailto:/);
    });

    it('renders only the addenda it is given', () => {
        const business = planTermsAddendumForCode('PREMIUM')!;
        render(<LegalSections sections={TERMS_SECTIONS} addenda={[business]} />);
        expect(screen.getByText('Business')).toBeInTheDocument();
        expect(screen.queryByText('Starter')).not.toBeInTheDocument();
    });

    it('badges the highlighted tier only when given a label', () => {
        render(
            <LegalSections
                sections={TERMS_SECTIONS}
                addenda={PLAN_TERMS_ADDENDA}
                highlightedSlug="growth"
                highlightLabel="The plan you are signing up for"
            />,
        );
        expect(screen.getByText('The plan you are signing up for')).toBeInTheDocument();
    });
});
