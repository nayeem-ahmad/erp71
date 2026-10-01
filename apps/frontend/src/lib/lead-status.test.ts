import { isOpenLifecycle, leadStatusLabel, leadStatusTone, stageOptionLabel } from './lead-status';

const translated = { NEW: 'নতুন', CONTACTED: 'যোগাযোগ', QUALIFIED: 'যোগ্য', LOST: 'হারানো', CONVERTED: 'রূপান্তরিত' };

describe('leadStatusLabel()', () => {
    it('translates a seeded stage the tenant has not renamed', () => {
        const stage = { code: 'CONTACTED', name: 'Contacted', is_system: true };
        expect(leadStatusLabel({ status: 'CONTACTED', statusOption: stage }, translated)).toBe('যোগাযোগ');
    });

    it('shows a renamed seeded stage verbatim', () => {
        const stage = { code: 'LOST', name: 'Dropped', is_system: true };
        expect(leadStatusLabel({ status: 'LOST', statusOption: stage }, translated)).toBe('Dropped');
    });

    it('shows a custom stage verbatim', () => {
        const stage = { code: 'NEGOTIATION', name: 'Negotiation', is_system: false };
        expect(leadStatusLabel({ status: 'QUALIFIED', statusOption: stage }, translated)).toBe('Negotiation');
    });

    it('falls back to the lifecycle for a lead not yet given a stage', () => {
        expect(leadStatusLabel({ status: 'QUALIFIED', statusOption: null }, translated)).toBe('যোগ্য');
        expect(leadStatusLabel({ status: 'ODD' }, translated)).toBe('ODD');
    });

    it('labels a bare option the same way', () => {
        expect(stageOptionLabel({ code: 'NEW', name: 'New', is_system: true }, translated)).toBe('নতুন');
        expect(stageOptionLabel({ code: 'X', name: 'X stage', is_system: false }, translated)).toBe('X stage');
    });
});

describe('leadStatusTone()', () => {
    it('keys the tone off the lifecycle, so custom stages read as open', () => {
        expect(leadStatusTone('NEW')).toBe('info');
        expect(leadStatusTone('QUALIFIED')).toBe('neutral');
        expect(leadStatusTone('CONVERTED')).toBe('success');
        expect(leadStatusTone('LOST')).toBe('danger');
    });
});

describe('isOpenLifecycle()', () => {
    it('treats the three working lifecycles as open', () => {
        expect(['NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'].filter(isOpenLifecycle)).toEqual([
            'NEW', 'CONTACTED', 'QUALIFIED',
        ]);
    });
});
