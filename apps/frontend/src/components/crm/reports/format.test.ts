import { formatRate } from './format';

describe('formatRate', () => {
    it('formats a rate in percent', () => {
        expect(formatRate(66.7, 'en', '—')).toBe('66.7%');
    });

    it('returns a dash for null', () => {
        expect(formatRate(null, 'en', '—')).toBe('—');
    });

    it('formats 0 as 0%', () => {
        expect(formatRate(0, 'en', '—')).toBe('0%');
    });
});
