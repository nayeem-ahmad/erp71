import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TenantPostEditor from './TenantPostEditor';
import { api } from '@/lib/api';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

let mockLocale: 'en' | 'bn' | 'ms' = 'en';
jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, get locale() { return mockLocale; } }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: jest.fn(),
}));

jest.mock('@/contexts/PlatformFeaturesContext', () => ({
    usePlatformFeatures: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getTenantBlogCategories: jest.fn(),
        getTenantBlogPost: jest.fn(),
        draftTenantBlogPost: jest.fn(),
        translateTenantBlogPost: jest.fn(),
    },
}));

const DRAFT = {
    translations: [
        {
            locale: 'en',
            title: 'Our shop is open late through Eid week',
            excerpt: 'Extended hours for the Eid rush.',
            body_md: '## Extended hours\n\nWe are open until midnight.',
            seo_title: 'Extended Eid hours',
            seo_description: 'Our shop stays open late through Eid week.',
        },
    ],
    slug: 'extended-eid-hours',
    cover_alt: 'A lit-up shopfront at night',
    category_id: 'cat-1',
    author_name: 'Shop Owner',
    featured: true,
};

const POST = {
    id: 'post-1',
    title: 'Our shop is open late through Eid week',
    excerpt: 'Extended hours for the Eid rush.',
    body_md: '## Extended hours\n\nWe are open until midnight.',
    seo_title: 'Extended Eid hours',
    seo_description: 'Our shop stays open late through Eid week.',
    slug: 'extended-eid-hours',
    status: 'DRAFT',
    category_id: 'cat-1',
    featured: false,
};

const BANGLA = {
    translations: [
        {
            locale: 'bn',
            title: 'ঈদের সপ্তাহে আমাদের দোকান রাত পর্যন্ত খোলা',
            excerpt: 'ঈদের ভিড়ের জন্য বাড়তি সময়।',
            body_md: '## বাড়তি সময়\n\nআমরা মধ্যরাত পর্যন্ত খোলা থাকি।',
            seo_title: 'ঈদের বাড়তি সময়',
            seo_description: 'ঈদের সপ্তাহজুড়ে আমাদের দোকান রাত পর্যন্ত খোলা।',
        },
    ],
};

function entitled() {
    (usePlatformFeatures as jest.Mock).mockReturnValue({ aiChat: true });
    (useTenantPlanFeatures as jest.Mock).mockReturnValue({
        planCode: 'PREMIUM',
        features: { premiumAi: true },
        dashboardPreference: 'AUTO',
        permissions: [],
        role: 'OWNER',
        ready: true,
    });
}

function notEntitled(overrides: { aiChat?: boolean; premiumAi?: boolean } = {}) {
    (usePlatformFeatures as jest.Mock).mockReturnValue({ aiChat: overrides.aiChat ?? true });
    (useTenantPlanFeatures as jest.Mock).mockReturnValue({
        planCode: 'FREE',
        features: { premiumAi: overrides.premiumAi ?? false },
        dashboardPreference: 'AUTO',
        permissions: [],
        role: 'OWNER',
        ready: true,
    });
}

describe('TenantPostEditor — AI Assistant gating and locale', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLocale = 'en';
        (api.getTenantBlogCategories as jest.Mock).mockResolvedValue([{ id: 'cat-1', name: 'Announcements' }]);
        (api.draftTenantBlogPost as jest.Mock).mockResolvedValue(DRAFT);
    });

    /**
     * Finding 3: every non-premium shop used to see the button and only learn
     * it needs Premium after typing a brief and pressing Generate. Pins that
     * the button now depends on both the platform kill switch and the plan
     * entitlement — the same two gates as every other AI feature.
     */
    it('hides the AI Assistant button when the tenant lacks the premiumAi entitlement', async () => {
        notEntitled({ premiumAi: false });

        render(<TenantPostEditor />);

        await waitFor(() => expect(api.getTenantBlogCategories).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: 'AI Assistant' })).not.toBeInTheDocument();
    });

    it('hides the AI Assistant button when the platform AI kill switch is off, even on a premium plan', async () => {
        notEntitled({ aiChat: false, premiumAi: true });

        render(<TenantPostEditor />);

        await waitFor(() => expect(api.getTenantBlogCategories).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: 'AI Assistant' })).not.toBeInTheDocument();
    });

    it('shows the AI Assistant button once both gates are open', async () => {
        entitled();

        render(<TenantPostEditor />);

        expect(await screen.findByRole('button', { name: 'AI Assistant' })).toBeInTheDocument();
    });

    /**
     * Finding 2: the tenant endpoint accepts an optional locale and the
     * backend already defaults to 'en' — the gap was the frontend never
     * sending the shop's own UI language. Pins that a Bangla-UI shop owner's
     * request carries 'bn' rather than silently falling back to English.
     */
    it('sends the UI locale with the draft request', async () => {
        entitled();
        mockLocale = 'bn';

        render(<TenantPostEditor />);
        fireEvent.click(await screen.findByRole('button', { name: 'AI Assistant' }));
        fireEvent.change(screen.getByLabelText('What should this post be about?'), {
            target: { value: 'Eid hours' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        await waitFor(() =>
            expect(api.draftTenantBlogPost).toHaveBeenCalledWith({ prompt: 'Eid hours', locale: 'bn' }),
        );
    });

    /**
     * A shop's post stores one title and one body, so a brief is written in the
     * one language the owner is working in. A language list on the brief would
     * promise a second copy that has nowhere to go.
     */
    it('asks for no language when writing from a brief', async () => {
        entitled();

        render(<TenantPostEditor />);
        fireEvent.click(await screen.findByRole('button', { name: 'AI Assistant' }));

        expect(screen.queryByText('Languages')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Translate into')).not.toBeInTheDocument();
    });

    // Nothing to translate yet, so the only thing on offer is writing.
    it('offers writing only until the post has words in it', async () => {
        entitled();

        render(<TenantPostEditor />);
        fireEvent.click(await screen.findByRole('button', { name: 'AI Assistant' }));

        expect(screen.getByRole('button', { name: 'Translate this post' })).toBeDisabled();
        expect(screen.getByText('Write the post first.')).toBeInTheDocument();
    });

    it('fills the form from the one language the assistant wrote', async () => {
        entitled();

        render(<TenantPostEditor />);
        fireEvent.click(await screen.findByRole('button', { name: 'AI Assistant' }));
        fireEvent.change(screen.getByLabelText('What should this post be about?'), {
            target: { value: 'Eid hours' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        expect(await screen.findByDisplayValue(DRAFT.translations[0].title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(DRAFT.slug)).toBeInTheDocument();
    });
});

describe('TenantPostEditor — translating the post it has', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLocale = 'en';
        entitled();
        (api.getTenantBlogCategories as jest.Mock).mockResolvedValue([{ id: 'cat-1', name: 'Announcements' }]);
        (api.getTenantBlogPost as jest.Mock).mockResolvedValue(POST);
        (api.translateTenantBlogPost as jest.Mock).mockResolvedValue(BANGLA);
    });

    async function openAssistant() {
        render(<TenantPostEditor postId="post-1" />);
        fireEvent.click(await screen.findByRole('button', { name: 'AI Assistant' }));
    }

    /** Waits for the modal to hand over to the confirm before answering it. */
    async function translateAnd(answer: 'Translate' | 'Cancel') {
        fireEvent.click(await screen.findByRole('button', { name: 'Translate' }));
        expect(await screen.findByText('Replace this post with the translation?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: answer }));
    }

    /**
     * The reason a shop owner reopens the assistant on a post that already has
     * words in it is almost never to have it rewritten from scratch.
     */
    it('opens on translating once the post has a title and a body', async () => {
        await openAssistant();

        expect(await screen.findByLabelText('This post is written in')).toHaveValue('en');
        expect(screen.getByLabelText('Translate into')).toBeInTheDocument();
        expect(screen.queryByLabelText('What should this post be about?')).not.toBeInTheDocument();
    });

    /**
     * The copy travels from the editor rather than from the saved post, so an
     * unsaved edit translates too — and the request carries one target, because
     * the post has one body for it to land in.
     */
    it('sends the copy in the editor and the one language to turn it into', async () => {
        await openAssistant();

        fireEvent.change(await screen.findByLabelText('Translate into'), { target: { value: 'bn' } });
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        await waitFor(() =>
            expect(api.translateTenantBlogPost).toHaveBeenCalledWith({
                source_locale: 'en',
                target_locales: ['bn'],
                title: POST.title,
                body_md: POST.body_md,
                excerpt: POST.excerpt,
                seo_title: POST.seo_title,
                seo_description: POST.seo_description,
            }),
        );
    });

    // A shop that serves its customers in Bangla runs the app in whatever it
    // likes, so the source is what the owner says it is — not the interface.
    it('translates from the language the owner says the post is in', async () => {
        await openAssistant();

        fireEvent.change(await screen.findByLabelText('This post is written in'), { target: { value: 'bn' } });
        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        await waitFor(() =>
            expect(api.translateTenantBlogPost).toHaveBeenCalledWith(
                expect.objectContaining({ source_locale: 'bn', target_locales: ['en'] }),
            ),
        );
    });

    /**
     * The post has one copy, so a translation replaces the words the owner
     * wrote. Nothing is swapped until they say so.
     */
    it('leaves the post alone when the owner cancels the replacement', async () => {
        await openAssistant();
        await translateAnd('Cancel');

        expect(screen.getByDisplayValue(POST.title)).toBeInTheDocument();
        expect(screen.queryByDisplayValue(BANGLA.translations[0].title)).not.toBeInTheDocument();
    });

    it('replaces the words once the owner confirms', async () => {
        await openAssistant();
        await translateAnd('Translate');

        expect(await screen.findByDisplayValue(BANGLA.translations[0].title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(BANGLA.translations[0].excerpt)).toBeInTheDocument();
        // A phrase from the body alone — getByDisplayValue collapses the
        // newlines a Markdown body is full of, so it cannot be matched whole.
        expect(screen.getByDisplayValue(/মধ্যরাত পর্যন্ত খোলা থাকি/)).toBeInTheDocument();
    });

    /**
     * The slug is the article's URL and the category is where it files — both
     * belong to the post, not to the language it happens to be written in. A
     * translation that renamed the slug would break every link to it.
     */
    it('leaves the slug and category as the owner set them', async () => {
        await openAssistant();
        await translateAnd('Translate');

        expect(await screen.findByDisplayValue(BANGLA.translations[0].title)).toBeInTheDocument();
        expect(screen.getByDisplayValue(POST.slug)).toBeInTheDocument();
        expect(screen.getByDisplayValue('Announcements')).toBeInTheDocument();
    });
});
