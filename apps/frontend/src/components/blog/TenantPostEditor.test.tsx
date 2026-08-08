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
    },
}));

const DRAFT = {
    title: 'Our shop is open late through Eid week',
    excerpt: 'Extended hours for the Eid rush.',
    body_md: '## Extended hours\n\nWe are open until midnight.',
    seo_title: 'Extended Eid hours',
    seo_description: 'Our shop stays open late through Eid week.',
    slug: 'extended-eid-hours',
    cover_alt: 'A lit-up shopfront at night',
    category_id: 'cat-1',
    author_name: 'Shop Owner',
    featured: true,
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
});
