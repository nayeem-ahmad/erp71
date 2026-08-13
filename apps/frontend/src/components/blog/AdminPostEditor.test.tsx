import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPostEditor from './AdminPostEditor';
import { api } from '@/lib/api';
import { useToastStore } from '@/lib/toast';

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
        translateAdminBlogPost: jest.fn(),
    },
}));

const EN = {
    locale: 'en',
    title: 'Cutting dead stock before Eid',
    excerpt: 'Stock sitting on a shelf is cash you cannot spend.',
    body_md: '## Why it matters\n\nDead stock ties up working capital.',
    seo_title: 'Cutting dead stock',
    seo_description: 'How small shops free up cash tied in slow-moving stock.',
};

const BN = {
    locale: 'bn',
    title: 'ঈদের আগে অবিক্রীত মজুদ কমানো',
    excerpt: 'তাকের উপর পড়ে থাকা মজুদ মানে আটকে থাকা টাকা।',
    body_md: '## কেন গুরুত্বপূর্ণ\n\nঅবিক্রীত মজুদ মূলধন আটকে রাখে।',
    seo_title: 'মজুদ কমানো',
    seo_description: 'ছোট দোকান কীভাবে আটকে থাকা টাকা মুক্ত করে।',
};

const DRAFT = {
    translations: [EN],
    slug: 'cutting-dead-stock',
    cover_alt: 'A shopkeeper counting stock',
    category_id: 'cat-1',
    author_name: 'ERP71 Team',
    author_title: 'Retail Operations',
    featured: true,
    audience: 'BOTH',
};

const EXISTING_POST = {
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
        {
            locale: 'en',
            title: 'Existing EN title',
            excerpt: '',
            body_md: 'Existing body',
            seo_title: '',
            seo_description: '',
        },
    ],
};

/** The assistant opens in translate mode as soon as a language has words. */
function switchToWriting() {
    const writeNew = screen.queryByRole('button', { name: 'Write new' });
    if (writeNew) fireEvent.click(writeNew);
}

async function openModalAndGenerate() {
    fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
    switchToWriting();
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
        (api.getAdminBlogPost as jest.Mock).mockResolvedValue(EXISTING_POST);
        (api.draftAdminBlogPost as jest.Mock).mockResolvedValue({ ...DRAFT, translations: [{ ...EN, locale: 'bn' }] });

        render(<AdminPostEditor postId="post-1" />);

        await screen.findByDisplayValue('existing-slug');

        // Switch to the BN tab, which has no translation row at all.
        fireEvent.click(screen.getByRole('button', { name: /^BN/ }));

        await openModalAndGenerate();

        // The confirm must appear ...
        expect(await screen.findByText('Replace what you have written?')).toBeInTheDocument();
        // ... and the draft must NOT have been applied yet.
        expect(screen.queryByDisplayValue(EN.title)).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('existing-slug')).toBeInTheDocument();

        // Confirming applies it, including the post-level fields.
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

        expect(await screen.findByDisplayValue(EN.title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(DRAFT.slug)).toBeInTheDocument();
    });

    /** A brand-new post with an empty form must still apply directly, with no confirm. */
    it('applies directly with no confirm on a brand-new, empty post', async () => {
        render(<AdminPostEditor />);

        await openModalAndGenerate();

        expect(screen.queryByText('Replace what you have written?')).not.toBeInTheDocument();
        expect(await screen.findByDisplayValue(EN.title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(DRAFT.slug)).toBeInTheDocument();
    });
});

describe('AdminPostEditor — generating several languages at once', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAdminBlogCategories as jest.Mock).mockResolvedValue([{ id: 'cat-1', name_en: 'Inventory' }]);
        (api.draftAdminBlogPost as jest.Mock).mockResolvedValue({ ...DRAFT, translations: [EN, BN] });
    });

    it('asks for every language the author ticked', async () => {
        render(<AdminPostEditor />);

        fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
        fireEvent.change(screen.getByLabelText('What should this post be about?'), {
            target: { value: 'dead stock before Eid' },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: /বাংলা/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        await waitFor(() =>
            expect(api.draftAdminBlogPost).toHaveBeenCalledWith({
                prompt: 'dead stock before Eid',
                locales: ['en', 'bn'],
            }),
        );
    });

    /**
     * One reply fills several tabs, so they have to be applied in one update —
     * patching them one at a time would leave every tab but the last unchanged,
     * each having started from the same stale array.
     */
    it('fills every language tab the assistant returned', async () => {
        render(<AdminPostEditor />);

        await openModalAndGenerate();

        expect(await screen.findByDisplayValue(EN.title)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^BN/ }));
        expect(screen.getByDisplayValue(BN.title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(BN.excerpt)).toBeInTheDocument();
    });

    // Each language is its own round-trip on the server, so a partial result is
    // a real outcome. Saying which ones are missing is the difference between
    // "retry Malay" and wondering why a tab is empty.
    it('names the languages that could not be written', async () => {
        (api.draftAdminBlogPost as jest.Mock).mockResolvedValue({
            ...DRAFT,
            translations: [EN],
            failed_locales: ['ms'],
        });
        useToastStore.setState({ toasts: [] });

        render(<AdminPostEditor />);

        await openModalAndGenerate();

        await waitFor(() =>
            expect(useToastStore.getState().toasts.map((row) => row.message).join(' ')).toContain('Bahasa Melayu'),
        );
    });
});

describe('AdminPostEditor — translating what is already written', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getAdminBlogCategories as jest.Mock).mockResolvedValue([{ id: 'cat-1', name_en: 'Inventory' }]);
        (api.getAdminBlogPost as jest.Mock).mockResolvedValue(EXISTING_POST);
        (api.translateAdminBlogPost as jest.Mock).mockResolvedValue({ translations: [BN] });
    });

    /**
     * The feature's whole point: an author who has written the post once should
     * not have to spend a second generation — which produces a different
     * article — to fill the other language tabs.
     */
    it('sends the open post’s own copy rather than a brief', async () => {
        render(<AdminPostEditor postId="post-1" />);
        await screen.findByDisplayValue('existing-slug');

        fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
        // Untick Malay so only Bangla is asked for.
        fireEvent.click(screen.getByRole('checkbox', { name: /Bahasa Melayu/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        await waitFor(() =>
            expect(api.translateAdminBlogPost).toHaveBeenCalledWith({
                source_locale: 'en',
                target_locales: ['bn'],
                title: 'Existing EN title',
                body_md: 'Existing body',
                excerpt: undefined,
                seo_title: undefined,
                seo_description: undefined,
            }),
        );
        expect(api.draftAdminBlogPost).not.toHaveBeenCalled();
    });

    it('fills the translated tab and leaves the source alone', async () => {
        render(<AdminPostEditor postId="post-1" />);
        await screen.findByDisplayValue('existing-slug');

        fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        // The BN tab is opened for review with the translation in it ...
        expect(await screen.findByDisplayValue(BN.title)).toBeInTheDocument();

        // ... and the English the author wrote is untouched.
        fireEvent.click(screen.getByRole('button', { name: /^EN/ }));
        expect(screen.getByDisplayValue('Existing EN title')).toBeInTheDocument();
    });

    /**
     * A translation is copy and nothing else. The slug, category, audience and
     * cover belong to the post and are shared by every language, so translating
     * must leave them exactly as the author set them — unlike a generation,
     * which rewrites them.
     */
    it('never rewrites the post-level fields', async () => {
        render(<AdminPostEditor postId="post-1" />);
        await screen.findByDisplayValue('existing-slug');

        fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        await screen.findByDisplayValue(BN.title);
        expect(screen.getByDisplayValue('existing-slug')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Existing Author')).toBeInTheDocument();
    });

    it('confirms before overwriting a target tab that already has content', async () => {
        (api.getAdminBlogPost as jest.Mock).mockResolvedValue({
            ...EXISTING_POST,
            translations: [
                ...EXISTING_POST.translations,
                { locale: 'bn', title: 'Hand-written BN', excerpt: '', body_md: 'Hand-written body', seo_title: '', seo_description: '' },
            ],
        });

        render(<AdminPostEditor postId="post-1" />);
        await screen.findByDisplayValue('existing-slug');

        fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }));
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        expect(await screen.findByText('Replace what you have written?')).toBeInTheDocument();
        expect(screen.queryByDisplayValue(BN.title)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

        expect(await screen.findByDisplayValue(BN.title)).toBeInTheDocument();
    });
});
