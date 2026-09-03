import {
    buildPitch,
    buildSignupUrl,
    buildWhatsAppUrl,
    printOnePager,
} from './share-kit';
import { openPrintWindow } from '@/lib/print';

jest.mock('@/lib/print', () => ({ openPrintWindow: jest.fn(() => ({} as Window)) }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

describe('referral share kit', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('buildSignupUrl', () => {
        /** `/r/<code>` records the click before forwarding; `/signup?ref=` does not. */
        it('points at the tracking route, not the bare signup page', () => {
            expect(buildSignupUrl('https://app.erp71.com', 'RAHMA1B2C3'))
                .toBe('https://app.erp71.com/r/RAHMA1B2C3');
        });

        it('escapes a code that would otherwise break the path', () => {
            expect(buildSignupUrl('https://app.erp71.com', 'A B/C')).toBe(
                'https://app.erp71.com/r/A%20B%2FC',
            );
        });
    });

    describe('buildPitch', () => {
        it('substitutes every occurrence of the link token', () => {
            expect(buildPitch('Try it: {link} — again: {link}', 'https://x.test/r/AB'))
                .toBe('Try it: https://x.test/r/AB — again: https://x.test/r/AB');
        });

        it('leaves a template with no token alone', () => {
            expect(buildPitch('No link here', 'https://x.test')).toBe('No link here');
        });
    });

    describe('buildWhatsAppUrl', () => {
        /**
         * The https form works on desktop web, Android and iOS and degrades to a
         * WhatsApp landing page; the `whatsapp://` scheme is a dead link without the
         * app installed.
         */
        it('uses the wa.me https form', () => {
            expect(buildWhatsAppUrl('hello')).toBe('https://wa.me/?text=hello');
        });

        it('encodes a Bangla message with a URL in it', () => {
            const url = buildWhatsAppUrl('শুরু করুন: https://app.erp71.com/r/AB?x=1&y=2');
            expect(url.startsWith('https://wa.me/?text=')).toBe(true);
            // The ? and & of the embedded link must not be read as query separators.
            expect(url).not.toContain('?x=1');
            expect(decodeURIComponent(url.slice('https://wa.me/?text='.length)))
                .toBe('শুরু করুন: https://app.erp71.com/r/AB?x=1&y=2');
        });
    });

    describe('printOnePager', () => {
        const data = {
            refereeName: 'Rahman Traders',
            referralCode: 'RAHMA1B2C3',
            signupUrl: 'https://app.erp71.com/r/RAHMA1B2C3',
            qrDataUrl: 'data:image/png;base64,AAAA',
            signupDiscount: 15,
            contactEmail: 'rahman@example.com',
        };
        const labels = {
            title: 'Run your shop from your phone',
            intro: 'Intro',
            codeLabel: 'Referral code',
            linkLabel: 'Or sign up at',
            scanHint: 'Scan to start',
            discountLine: 'Get {pct}% off your first subscription.',
            contactLine: 'Referred by {name} — {email}',
        };

        it('fills the discount, name and email placeholders', () => {
            printOnePager(data, labels);
            const html = (openPrintWindow as jest.Mock).mock.calls[0][0].bodyHtml;
            expect(html).toContain('Get 15% off your first subscription.');
            expect(html).toContain('Referred by Rahman Traders — rahman@example.com');
        });

        it('embeds the QR and the code', () => {
            printOnePager(data, labels);
            const html = (openPrintWindow as jest.Mock).mock.calls[0][0].bodyHtml;
            expect(html).toContain(data.qrDataUrl);
            expect(html).toContain('RAHMA1B2C3');
        });

        /** A partner's own name is free text and lands in generated markup. */
        it('escapes a name containing markup', () => {
            printOnePager({ ...data, refereeName: '<img onerror=x>' }, labels);
            const html = (openPrintWindow as jest.Mock).mock.calls[0][0].bodyHtml;
            expect(html).not.toContain('<img onerror=x>');
            expect(html).toContain('&lt;img onerror=x&gt;');
        });

        /**
         * Not jsPDF: the copy can be Bangla, and only a real browser window has the
         * fonts for it. A regression here prints boxes.
         */
        it('goes through the shared print window on A4', () => {
            printOnePager(data, labels);
            expect(openPrintWindow).toHaveBeenCalledWith(
                expect.objectContaining({ paperSize: 'A4' }),
            );
        });
    });
});
