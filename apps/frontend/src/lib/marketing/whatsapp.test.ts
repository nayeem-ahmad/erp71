import { marketingMessages as bn } from '@/lib/localization/messages/bn/marketing';
import { marketingMessages as en } from '@/lib/localization/messages/en/marketing';

import { MARKETING_WHATSAPP_LINKS } from './whatsapp';

describe('marketing WhatsApp links', () => {
    it('points the hero and pricing CTAs at the tracked short links', () => {
        expect(MARKETING_WHATSAPP_LINKS.home).toBe('https://app.erp71.com/s/hdj9e7');
        expect(MARKETING_WHATSAPP_LINKS.pricing).toBe('https://app.erp71.com/s/d8g825');
    });
});

describe('marketing WhatsApp copy', () => {
    it('uses the requested Bangla and English strings', () => {
        expect(en.home.hero.whatsappDemo).toBe('Book a 15-min demo on WhatsApp');
        expect(en.home.hero.setupHelp).toBe('Help with setup included');
        expect(`${en.pricing.planHelpBefore}${en.pricing.planHelpLink}${en.pricing.planHelpAfter}`).toBe(
            "Not sure which plan fits your shop? WhatsApp us and we'll set it up with you in 15 minutes.",
        );

        expect(bn.home.hero.whatsappDemo).toBe('১৫ মিনিটের ডেমো নিন, WhatsApp করুন');
        expect(bn.home.hero.setupHelp).toBe('সেটআপে আমরা সাথে থাকব');
        expect(`${bn.pricing.planHelpBefore}${bn.pricing.planHelpLink}${bn.pricing.planHelpAfter}`).toBe(
            'কোন প্ল্যান আপনার দোকানের জন্য ঠিক, বুঝতে পারছেন না? WhatsApp করুন। ১৫ মিনিটে আমরা একসাথে সেট করে দেব।',
        );
    });
});
