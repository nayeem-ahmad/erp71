import { blockKey, extractMeasureTokens, stripMeasureTokens } from './blocking';

describe('extractMeasureTokens', () => {
    it('extracts a strength with an attached unit', () => {
        expect(extractMeasureTokens('Napa 500mg')).toEqual(['500mg']);
    });

    it('extracts a strength written with a space', () => {
        expect(extractMeasureTokens('Napa 500 mg')).toEqual(['500mg']);
    });

    it('extracts a pack count written as 10s', () => {
        expect(extractMeasureTokens('Napa 10s')).toEqual(['10s']);
    });

    it('treats "(10 pcs)" as the same pack token as "10s"', () => {
        expect(extractMeasureTokens('Napa (10 pcs)')).toEqual(['10s']);
    });

    it('returns tokens sorted so order in the name does not matter', () => {
        expect(extractMeasureTokens('Napa 500mg 10s')).toEqual(['10s', '500mg']);
        expect(extractMeasureTokens('Napa 10s 500mg')).toEqual(['10s', '500mg']);
    });

    it('normalizes Bengali digits in a measure', () => {
        expect(extractMeasureTokens('নাপা ৫০০ mg')).toEqual(['500mg']);
    });

    it('returns an empty array when there is no measure', () => {
        expect(extractMeasureTokens('Hand Sanitizer')).toEqual([]);
    });

    it('handles ml and litre volumes', () => {
        expect(extractMeasureTokens('Savlon 100ml')).toEqual(['100ml']);
        expect(extractMeasureTokens('Savlon 1 litre')).toEqual(['1l']);
    });
});

describe('blockKey', () => {
    it('is identical for the same product written two ways', () => {
        expect(blockKey('Napa 500mg')).toBe(blockKey('Square Napa 500 mg'));
    });

    it('DIFFERS for different strengths — these must never be compared', () => {
        expect(blockKey('Napa 500mg')).not.toBe(blockKey('Napa 665mg'));
    });

    it('differs for different pack sizes', () => {
        expect(blockKey('Napa 500mg 10s')).not.toBe(blockKey('Napa 500mg 20s'));
    });

    it('groups all measureless products into one block', () => {
        expect(blockKey('Hand Sanitizer')).toBe('');
        expect(blockKey('Face Towel')).toBe('');
    });

    it('separates a measured product from a measureless one', () => {
        expect(blockKey('Napa 500mg')).not.toBe(blockKey('Napa'));
    });
});

describe('stripMeasureTokens', () => {
    it('removes the measures and leaves the descriptive words', () => {
        expect(stripMeasureTokens('Square Napa 500 mg 10s')).toBe('square napa');
    });

    it('leaves a measureless name as its normalized self', () => {
        expect(stripMeasureTokens('Hand Sanitizer')).toBe('hand sanitizer');
    });
});
