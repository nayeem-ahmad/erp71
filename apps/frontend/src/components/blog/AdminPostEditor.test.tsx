import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPostEditor from './AdminPostEditor';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getAdminBlogCategories: jest.fn(),
        getAdminBlogPost: jest.fn(),
        draftAdminBlogPost: jest.fn(),
    },
}));

const DRAFT = {
    title: 'Cutting dead stock before Eid',
    excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
    body_md: '## Why it matters\n\nDead stock ties up working capital.',
    seo_title: 'Cutting dead stock',
    seo_description: 'How small shops free up cash tied in slow-moving stock.',
    slug: 'cutting-dead-stock',
    cover_alt: 'A shopkeeper counting stock',
    category_id: 'cat-1',
    author_name: 'ERP71 Team',
    author_title: 'Retail Operations',
    featured: true,
    audience: 'BOTH',
};

async function openModalAndGenerate() {
    fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
    fireEvent.change(screen.getByLabelText('What should this post be about?'), {
        target: { value: 'dead stock before Eid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    // Let the mocked draftAdminBlogPost promise resolve.
    await waitFor(() => expect(api.draftAdminBlogPost).toHaveBeenCalled());
}

describe('AdminPostEditor — AI draft overwrite guard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAdminBlogCategories as jest.Mock).mockResolvedValue([{ id: 'cat-1', name_en: 'Inventory' }]);
        (api.draftAdminBlogPost as jest.Mock).mockResolvedValue(DRAFT);
    });

    /**
     * Pins Finding 1: for an existing post, generating on an empty BN tab must
     * still confirm before applying, because applyDraft also overwrites the
     * post-level fields (slug, category, audience, author, featured) that the
     * open tab's emptiness says nothing about. Against the pre-fix code —
     * which only inspected the open tab's title/excerpt/body — this post has
     * an empty BN tab and so `hasContent` was false, applying instantly with
     * no confirm.
     */
    it('confirms before replacing an existing post’s populated fields, even when the open tab is empty', async () => {
        (api.getAdminBlogPost as jest.Mock).mockResolvedValue({
            id: 'post-1',
            slug: 'existing-slug',
            status: 'PUBLISHED',
            audience: 'IN_APP',
            category_id: 'cat-1',
            author_name: 'Existing Author',
            author_title: 'Editor',
            cover_image_url: null,
            cover_alt: '',
            featured: false,
            translations: [
                { locale: 'en', title: 'Existing EN title', excerpt: '', body_md: 'Existing body', seo_title: '', seo_description: '' },
            ],
        });

        render(<AdminPostEditor postId="post-1" />);

        await screen.findByDisplayValue('existing-slug');

        // Switch to the BN tab, which has no translation row at all.
        fireEvent.click(screen.getByRole('button', { name: /^BN/ }));

        await openModalAndGenerate();

        // The confirm must appear ...
        expect(await screen.findByText('Replace what you have written?')).toBeInTheDocument();
        // ... and the draft must NOT have been applied yet.
        expect(screen.queryByDisplayValue(DRAFT.title)).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('existing-slug')).toBeInTheDocument();

        // Confirming applies it, including the post-level fields.
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

        expect(await screen.findByDisplayValue(DRAFT.title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(DRAFT.slug)).toBeInTheDocument();
    });

    /** A brand-new post with an empty form must still apply directly, with no confirm. */
    it('applies directly with no confirm on a brand-new, empty post', async () => {
        render(<AdminPostEditor />);

        await openModalAndGenerate();

        expect(screen.queryByText('Replace what you have written?')).not.toBeInTheDocument();
        expect(await screen.findByDisplayValue(DRAFT.title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(DRAFT.slug)).toBeInTheDocument();
    });
});
