import React from 'react';
import { render, screen } from '@testing-library/react';
import BlogLanguageSwitch from './BlogLanguageSwitch';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

/**
 * The switch is a pair of real links rather than a client-side toggle, and the
 * tests pin that: a `button` here would mean the Bangla page has no URL to
 * share and no URL for a crawler to follow, which is most of the point of
 * translating it.
 */
describe('BlogLanguageSwitch', () => {
    it('links to the Bangla URL while reading English', () => {
        render(<BlogLanguageSwitch path="/blog/stock-tips" locale="en" />);

        expect(screen.getByRole('link', { name: 'বাংলা' })).toHaveAttribute(
            'href',
            '/blog/stock-tips?lang=bn',
        );
    });

    it('links back to the clean English URL while reading Bangla', () => {
        render(<BlogLanguageSwitch path="/blog/stock-tips" locale="bn" />);

        expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
            'href',
            '/blog/stock-tips',
        );
    });

    it('marks the language being read as current for screen readers', () => {
        render(<BlogLanguageSwitch path="/blog" locale="bn" />);

        expect(screen.getByText('বাংলা')).toHaveAttribute('aria-current', 'true');
    });

    it('renders nothing when the post has no Bangla translation', () => {
        // Offering a switch that lands the reader back on English is worse than
        // offering none: the click looks broken rather than unavailable.
        const { container } = render(
            <BlogLanguageSwitch path="/blog/only-english" locale="en" availableLocales={['en']} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders the switch when the post does have a Bangla translation', () => {
        render(
            <BlogLanguageSwitch path="/blog/both" locale="en" availableLocales={['en', 'bn']} />,
        );

        expect(screen.getByRole('link', { name: 'বাংলা' })).toBeInTheDocument();
    });

    it('always offers both languages on an index, which is not one post', () => {
        // No `availableLocales` means a listing page rather than an article:
        // the index itself is translated regardless of which posts are.
        render(<BlogLanguageSwitch path="/blog" locale="en" />);

        expect(screen.getByRole('link', { name: 'বাংলা' })).toBeInTheDocument();
    });

    it('preserves an existing query so switching language keeps the page', () => {
        render(<BlogLanguageSwitch path="/blog?page=3" locale="en" />);

        expect(screen.getByRole('link', { name: 'বাংলা' })).toHaveAttribute(
            'href',
            '/blog?page=3&lang=bn',
        );
    });

    it('tags each link with its own language so a crawler reads them correctly', () => {
        render(<BlogLanguageSwitch path="/blog" locale="en" />);

        expect(screen.getByRole('link', { name: 'বাংলা' })).toHaveAttribute('hrefLang', 'bn');
    });
});
