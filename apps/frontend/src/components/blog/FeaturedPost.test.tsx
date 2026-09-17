import React from 'react';
import { render, screen } from '@testing-library/react';
import FeaturedPost from './FeaturedPost';
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
        excerpt: null,
        cover_image_url: null,
        cover_alt: null,
        author_name: 'Nayeem Ahmad',
        author_title: null,
        published_at: '2026-03-04T00:00:00.000Z',
        edited_at: null,
        reading_minutes: 5,
        featured: true,
        category: { slug: 'guides', name_en: 'Guides', name_bn: 'নির্দেশিকা', name_ms: null },
        available_locales: ['en', 'bn'],
        ...overrides,
    };
}

describe('FeaturedPost', () => {
    it('shows the category in the reader language', () => {
        render(<FeaturedPost post={post()} locale="bn" />);

        expect(screen.getByRole('link', { name: 'নির্দেশিকা' })).toBeInTheDocument();
    });

    it('keeps the language on both the category and the headline link', () => {
        render(<FeaturedPost post={post()} locale="bn" />);

        expect(screen.getByRole('link', { name: 'নির্দেশিকা' })).toHaveAttribute(
            'href',
            '/blog/category/guides?lang=bn',
        );
        expect(screen.getByRole('link', { name: 'Stock tips' })).toHaveAttribute(
            'href',
            '/blog/stock-tips?lang=bn',
        );
    });

    it('writes the meta line in the reader language', () => {
        render(<FeaturedPost post={post()} locale="bn" />);

        expect(screen.getByText(/৫ মিনিটের পড়া/)).toBeInTheDocument();
    });

    it('defaults to English so existing callers keep working', () => {
        render(<FeaturedPost post={post()} />);

        expect(screen.getByRole('link', { name: 'Guides' })).toHaveAttribute(
            'href',
            '/blog/category/guides',
        );
    });
});
