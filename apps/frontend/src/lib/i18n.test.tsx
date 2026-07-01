import { fireEvent, render, screen } from '@testing-library/react';

jest.unmock('@/lib/i18n');

import LanguageSwitcher from '../components/LanguageSwitcher';
import { TenantLocaleProvider } from '../contexts/TenantLocaleContext';
import { I18nProvider } from './i18n';

// A tenant with localization enabled and Bengali as the secondary locale — the
// switcher only ever exposes English plus one secondary locale at a time
// (see getTenantEnabledLocales), never all three simultaneously.
const bengaliTenant = { localization_enabled: true, secondary_locale: 'bn' };

describe('I18nProvider', () => {
    beforeEach(() => {
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'ltr';
        document.cookie = 'locale=; path=/; max-age=0';
        localStorage.clear();
    });

    it('renders only enabled locales in the switcher', () => {
        render(
            <I18nProvider initialLocale="en">
                <TenantLocaleProvider tenant={bengaliTenant}>
                    <LanguageSwitcher />
                </TenantLocaleProvider>
            </I18nProvider>
        );

        const select = screen.getByLabelText('Language');
        expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'বাংলা' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Bahasa Melayu' })).not.toBeInTheDocument();
        expect(select).toHaveValue('en');
    });

    it('updates html attributes and persistence when locale changes', () => {
        render(
            <I18nProvider initialLocale="en">
                <TenantLocaleProvider tenant={bengaliTenant}>
                    <LanguageSwitcher />
                </TenantLocaleProvider>
            </I18nProvider>
        );

        fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'bn' } });

        expect(document.documentElement.lang).toBe('bn');
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.documentElement.dataset.locale).toBe('bn');
        expect(localStorage.getItem('locale')).toBe('bn');
        expect(document.cookie).toContain('locale=bn');
    });
});