import { newAccountLocale } from './new-account-locale';

describe('newAccountLocale', () => {
    it('returns the workspace language when localization is on', () => {
        expect(newAccountLocale({ default_locale: 'bn', localization_enabled: true })).toBe('bn');
    });

    it('returns en when localization is off, whatever the stored default', () => {
        expect(newAccountLocale({ default_locale: 'bn', localization_enabled: false })).toBe('en');
    });

    it('returns en when the workspace default is blank', () => {
        expect(newAccountLocale({ default_locale: '', localization_enabled: true })).toBe('en');
    });
});
