import {
    deriveKnockSubject,
    inboxEnabled,
    isCategoryEnabled,
    isFeedbackCategory,
    isKnockCategory,
    parseTicketNumberQuery,
    threadCategoryWhere,
} from './support.util';

describe('support.util', () => {
    describe('isKnockCategory', () => {
        it('accepts support and the three feedback types', () => {
            expect(isKnockCategory('support')).toBe(true);
            expect(isKnockCategory('bug')).toBe(true);
            expect(isKnockCategory('feature')).toBe(true);
            expect(isKnockCategory('general')).toBe(true);
        });

        it('rejects unknown values', () => {
            expect(isKnockCategory('other')).toBe(false);
            expect(isKnockCategory('')).toBe(false);
        });
    });

    describe('isFeedbackCategory', () => {
        it('is true only for bug, feature, and general', () => {
            expect(isFeedbackCategory('bug')).toBe(true);
            expect(isFeedbackCategory('support')).toBe(false);
        });
    });

    describe('inboxEnabled / isCategoryEnabled', () => {
        it('opens the inbox when either flag is on', () => {
            expect(inboxEnabled({ support: false, feedback: false })).toBe(false);
            expect(inboxEnabled({ support: true, feedback: false })).toBe(true);
            expect(inboxEnabled({ support: false, feedback: true })).toBe(true);
        });

        it('gates help vs feedback types by the matching flag', () => {
            const onlySupport = { support: true, feedback: false };
            const onlyFeedback = { support: false, feedback: true };
            expect(isCategoryEnabled(onlySupport, 'support')).toBe(true);
            expect(isCategoryEnabled(onlySupport, 'bug')).toBe(false);
            expect(isCategoryEnabled(onlyFeedback, 'support')).toBe(false);
            expect(isCategoryEnabled(onlyFeedback, 'feature')).toBe(true);
        });
    });

    describe('deriveKnockSubject', () => {
        it('uses the first line of a support message', () => {
            expect(deriveKnockSubject('support', '  Printer will not print  ')).toBe('Printer will not print');
        });

        it('prefers "Type on /page" for feedback', () => {
            expect(deriveKnockSubject('bug', 'buttons overlap', '/sales/new')).toBe('Bug on /sales/new');
            expect(deriveKnockSubject('feature', 'export csv', '/reports')).toBe('Feature on /reports');
            expect(deriveKnockSubject('general', 'thanks', '/dashboard')).toBe('Feedback on /dashboard');
        });

        it('falls back to the message when there is no page', () => {
            expect(deriveKnockSubject('bug', 'checkout crashes')).toBe('checkout crashes');
        });
    });

    describe('threadCategoryWhere', () => {
        it('filters a single category', () => {
            expect(threadCategoryWhere('bug')).toEqual({ category: 'bug' });
        });

        it('treats kind=feedback as the three feedback types', () => {
            expect(threadCategoryWhere(undefined, 'feedback')).toEqual({
                category: { in: ['bug', 'feature', 'general'] },
            });
            expect(threadCategoryWhere('feedback')).toEqual({
                category: { in: ['bug', 'feature', 'general'] },
            });
        });

        it('returns an empty where when unfiltered', () => {
            expect(threadCategoryWhere()).toEqual({});
        });
    });

    describe('parseTicketNumberQuery', () => {
        it('reads a bare number and a hashed one', () => {
            expect(parseTicketNumberQuery('1042')).toBe(1042);
            expect(parseTicketNumberQuery('#1042')).toBe(1042);
            expect(parseTicketNumberQuery('  # 1042 ')).toBe(1042);
        });

        it('is null for anything that is not a ticket number', () => {
            expect(parseTicketNumberQuery('printer')).toBeNull();
            expect(parseTicketNumberQuery('order 1042')).toBeNull();
            expect(parseTicketNumberQuery('')).toBeNull();
            expect(parseTicketNumberQuery('0')).toBeNull();
            expect(parseTicketNumberQuery('-3')).toBeNull();
        });

        it('is null for a number too big to be an int4 ticket id', () => {
            // Postgres would raise "out of range" on the comparison rather than
            // simply not matching, so this has to fall back to a text search.
            expect(parseTicketNumberQuery('99999999999')).toBeNull();
        });
    });
});
