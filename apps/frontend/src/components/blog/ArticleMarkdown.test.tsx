import React from 'react';
import { render, screen } from '@testing-library/react';
import ArticleMarkdown from './ArticleMarkdown';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

/**
 * The safety assertions here are the reason this component exists separately
 * from `ui/Markdown`: it deliberately *allows* images, so the things it still
 * refuses need pinning explicitly. A regression that swapped `skipHtml` for
 * `rehype-raw` would make every one of these pass silently otherwise.
 */
describe('ArticleMarkdown', () => {
    it('renders headings as a real hierarchy rather than flattening them', () => {
        render(<ArticleMarkdown content={'## Section\n\n### Subsection'} />);

        expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 3, name: 'Subsection' })).toBeInTheDocument();
    });

    it('starts a body h1 at h2, leaving the page title as the only h1', () => {
        render(<ArticleMarkdown content={'# Body heading'} />);

        expect(screen.getByRole('heading', { level: 2, name: 'Body heading' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });

    it('does not render raw HTML in a post body', () => {
        const { container } = render(
            <ArticleMarkdown content={'<div id="injected">hello</div>\n\nAfter'} />,
        );

        expect(container.querySelector('#injected')).toBeNull();
    });

    it('does not execute or emit a script tag from the body', () => {
        const { container } = render(
            <ArticleMarkdown content={'<script>window.pwned = true</script>\n\nSafe text'} />,
        );

        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByText('Safe text')).toBeInTheDocument();
    });

    it('renders images, unlike the chat renderer, and keeps their alt text', () => {
        render(<ArticleMarkdown content={'![a full shelf](https://cdn.example.com/shelf.png)'} />);

        const image = screen.getByAltText('a full shelf');
        expect(image).toHaveAttribute('src', 'https://cdn.example.com/shelf.png');
        expect(image).toHaveAttribute('loading', 'lazy');
    });

    it('gives an image with no alt an empty one, so it is skipped rather than read as a filename', () => {
        const { container } = render(<ArticleMarkdown content={'![](https://cdn.example.com/x.png)'} />);
        expect(container.querySelector('img')).toHaveAttribute('alt', '');
    });

    it('opens external links in a new tab with no referrer and nofollow', () => {
        render(<ArticleMarkdown content={'[a vendor](https://example.com)'} />);

        const link = screen.getByRole('link', { name: 'a vendor' });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        expect(link).toHaveAttribute('rel', expect.stringContaining('nofollow'));
    });

    it('keeps an internal link in the same tab', () => {
        render(<ArticleMarkdown content={'[our pricing](/pricing)'} />);

        const link = screen.getByRole('link', { name: 'our pricing' });
        expect(link).not.toHaveAttribute('target');
    });

    it('treats a protocol-relative link as external rather than as an in-app path', () => {
        // "//evil.example" starts with "/" but leaves the site.
        render(<ArticleMarkdown content={'[offsite](//evil.example)'} />);

        expect(screen.getByRole('link', { name: 'offsite' })).toHaveAttribute('target', '_blank');
    });

    it('renders GFM tables inside a scroll container so the page never scrolls sideways', () => {
        const { container } = render(
            <ArticleMarkdown content={'| a | b |\n| - | - |\n| 1 | 2 |'} />,
        );

        const table = container.querySelector('table');
        expect(table).toBeInTheDocument();
        expect(table?.parentElement?.className).toContain('overflow-x-auto');
    });
});
