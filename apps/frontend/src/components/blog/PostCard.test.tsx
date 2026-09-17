import React from 'react';
import { render, screen } from '@testing-library/react';
import PostCard, { postMeta } from './PostCard';
import type { BlogListPost } from '@/lib/blog/api';

jest.mock('next/link', () => {
    const MockLink = ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
        React.createElement('a', { href, ...rest }, children);
    MockLink.displayName = 'MockLink';
    return MockLink;
});

function post(overrides: Partial<BlogListPost> = {}): BlogListPost {
    return {
        id: 'p1',
        slug: 'stock-tips',
        locale: 'en',
        title: 'Stock tips',
        excerpt: 'How to count what you have.',
        cover_image_url: null,
        cover_alt: null,
        author_name: 'Nayeem Ahmad',
        author_title: null,
        published_at: '2026-03-04T00:00:00.000Z',
        edited_at: null,
        reading_minutes: 5,
        featured: false,
        category: { slug: 'guides', name_en: 'Guides', name_bn: 'নির্দেশিকা', name_ms: null },
        available_locales: ['en', 'bn'],
        ...overrides,
    };
}

/**
 * The card is where a half-translated page shows first: the title arrives
 * already translated from the API, so an untranslated category chip or an
 * English date sits directly beside Bangla prose.
 */
describe('PostCard', () => {
    it('shows the category in the reader language', () => {
        render(<PostCard post={post()} locale="bn" />);

        expect(screen.getByText('নির্দেশিকা')).toBeInTheDocument();
        expect(screen.queryByText('Guides')).not.toBeInTheDocument();
    });

    it('falls back to the English category when there is no Bangla name', () => {
        const untranslated = post({
            category: { slug: 'news', name_en: 'News', name_bn: null, name_ms: null },
        });
        render(<PostCard post={untranslated} locale="bn" />);

        expect(screen.getByText('News')).toBeInTheDocument();
    });

    it('keeps the reader in their language when they open a post', () => {
        render(<PostCard post={post()} locale="bn" />);

        expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/blog/stock-tips?lang=bn');
    });

    it('leaves the English link clean', () => {
        render(<PostCard post={post()} locale="en" />);

        expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/blog/stock-tips');
    });

    it('defaults to English so existing callers keep working', () => {
        render(<PostCard post={post()} />);

        expect(screen.getByText('Guides')).toBeInTheDocument();
    });
});

describe('postMeta', () => {
    it('writes the reading time in the reader language', () => {
        expect(postMeta(post(), 'en')).toContain('5 min read');
        expect(postMeta(post(), 'bn')).toContain('৫ মিনিটের পড়া');
    });

    it('formats the date in the reader language', () => {
        // bn-BD renders Bengali digits, so an English date beside Bangla prose
        // is visible immediately rather than subtly wrong.
        expect(postMeta(post(), 'bn')).toMatch(/[০-৯]/);
    });

    it('omits the reading time when a post has none', () => {
        expect(postMeta(post({ reading_minutes: 0 }), 'en')).not.toContain('min read');
    });
});
