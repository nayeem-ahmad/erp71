import { displayName, initialsFor } from './types';

describe('displayName', () => {
    it('prefers the name and falls back to the email', () => {
        expect(displayName({ name: 'Karim Rahman', email: 'k@x.com' })).toBe('Karim Rahman');
        expect(displayName({ name: '   ', email: 'k@x.com' })).toBe('k@x.com');
        expect(displayName({ name: null, email: 'k@x.com' })).toBe('k@x.com');
    });
});

describe('initialsFor', () => {
    it('uses the first and last name', () => {
        expect(initialsFor({ name: 'Karim Rahman' })).toBe('KR');
        expect(initialsFor({ name: 'Ayesha Binte Noor' })).toBe('AN');
    });

    it('takes two letters from a single word', () => {
        expect(initialsFor({ name: 'Karim' })).toBe('KA');
    });

    it('falls back to the email when there is no name', () => {
        expect(initialsFor({ name: null, email: 'karim@x.com' })).toBe('KA');
    });

    it('never returns an empty monogram', () => {
        expect(initialsFor({ name: null, email: null })).toBe('?');
    });
});
