import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unmock('@/lib/i18n');

import LanguageSwitcher from '../components/LanguageSwitcher';
import { TenantLocaleProvider } from '../contexts/TenantLocaleContext';
import { messageCatalog } from '@/test-utils/message-catalog';
import { I18nProvider, useI18n } from './i18n';
import { getLocaleConfig } from './localization/config';
import { messageLoaders, type MessageDictionary } from './localization/messages';

// A tenant with localization enabled and Bengali as the secondary locale — the
// switcher only ever exposes English plus one secondary locale at a time
// (see getTenantEnabledLocales), never all three simultaneously.
const bengaliTenant = { localization_enabled: true, secondary_locale: 'bn' };

/*
 * Loaded dictionaries are cached for the life of the module, as they are for
 * the life of a page. So each test that loads a language uses one no other test
 * here touches, and the tests stay independent of their order.
 */

function DashboardLabel() {
    const { locale, t } = useI18n();
    return <p data-locale={locale}>{t.nav.dashboard}</p>;
}

/** A chunk "in flight", settled by the test when it chooses. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('I18nProvider', () => {
    beforeEach(() => {
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'ltr';
        delete document.documentElement.dataset.locale;
        document.cookie = 'locale=; path=/; max-age=0';
        localStorage.clear();
    });

    afterEach(() => jest.restoreAllMocks());

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

    it('updates html attributes and persistence when locale changes', async () => {
        render(
            <I18nProvider initialLocale="en">
                <TenantLocaleProvider tenant={bengaliTenant}>
                    <LanguageSwitcher />
                </TenantLocaleProvider>
            </I18nProvider>
        );

        fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'bn' } });

        await waitFor(() => expect(document.documentElement.lang).toBe('bn'));
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.documentElement.dataset.locale).toBe('bn');
        expect(localStorage.getItem('locale')).toBe('bn');
        expect(document.cookie).toContain('locale=bn');
    });

    it('renders a non-English initial locale once its dictionary has arrived — never English first', async () => {
        const chunk = deferred<MessageDictionary>();
        jest.spyOn(messageLoaders, 'hi').mockReturnValue(chunk.promise);
        // What the server marks <html> with when it renders in Hindi.
        document.documentElement.lang = 'hi';

        let container!: HTMLElement;
        await act(async () => {
            ({ container } = render(
                <I18nProvider initialLocale="hi">
                    <DashboardLabel />
                </I18nProvider>
            ));
        });

        // Suspended on the chunk, with nothing committed: in the browser the
        // server's Hindi HTML stays up meanwhile. An English render here would
        // be the flash this design exists to avoid.
        expect(container).toBeEmptyDOMElement();

        await act(async () => {
            chunk.resolve(messageCatalog.hi);
        });

        expect(screen.getByText(messageCatalog.hi.nav.dashboard)).toHaveAttribute('data-locale', 'hi');
        expect(localStorage.getItem('locale')).toBe('hi');
    });

    it('switches language only once the new dictionary has arrived', async () => {
        const chunk = deferred<MessageDictionary>();
        jest.spyOn(messageLoaders, 'ms').mockReturnValue(chunk.promise);

        render(
            <I18nProvider initialLocale="en">
                <TenantLocaleProvider tenant={{ localization_enabled: true, secondary_locale: 'ms' }}>
                    <LanguageSwitcher />
                    <DashboardLabel />
                </TenantLocaleProvider>
            </I18nProvider>
        );

        fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ms' } });

        // Still fully English while Malay is on its way: nothing has switched
        // ahead of its words.
        expect(screen.getByText(messageCatalog.en.nav.dashboard)).toHaveAttribute('data-locale', 'en');
        expect(screen.getByLabelText('Language')).toHaveValue('en');
        expect(document.documentElement.lang).toBe('en');
        expect(localStorage.getItem('locale')).toBe('en');

        await act(async () => {
            chunk.resolve(messageCatalog.ms);
        });

        expect(screen.getByText(messageCatalog.ms.nav.dashboard)).toHaveAttribute('data-locale', 'ms');
        expect(document.documentElement.lang).toBe(getLocaleConfig('ms').htmlLang);
        expect(localStorage.getItem('locale')).toBe('ms');
    });

    it('stays in the current language when the next one fails to load', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(messageLoaders, 'fr').mockRejectedValue(new Error('Loading chunk messages-fr failed.'));

        render(
            <I18nProvider initialLocale="en">
                <TenantLocaleProvider tenant={{ localization_enabled: true, secondary_locale: 'fr' }}>
                    <LanguageSwitcher />
                    <DashboardLabel />
                </TenantLocaleProvider>
            </I18nProvider>
        );

        await act(async () => {
            fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
        });

        expect(console.warn).toHaveBeenCalled();
        expect(screen.getByLabelText('Language')).toHaveValue('en');
        expect(screen.getByText(messageCatalog.en.nav.dashboard)).toBeInTheDocument();
        expect(localStorage.getItem('locale')).toBe('en');
    });

    it('falls back to English, not a blank screen, when the initial locale fails to load', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const chunk = deferred<MessageDictionary>();
        jest.spyOn(messageLoaders, 'de').mockReturnValue(chunk.promise);
        document.documentElement.lang = 'de';
        localStorage.setItem('locale', 'de');

        await act(async () => {
            render(
                <I18nProvider initialLocale="de">
                    <DashboardLabel />
                </I18nProvider>
            );
        });
        await act(async () => {
            chunk.reject(new Error('Loading chunk messages-de failed.'));
        });

        expect(screen.getByText(messageCatalog.en.nav.dashboard)).toHaveAttribute('data-locale', 'en');
        expect(console.warn).toHaveBeenCalled();
        // <html> follows the words on screen, but the German preference is not
        // overwritten — the next page load tries again.
        await waitFor(() => expect(document.documentElement.lang).toBe('en'));
        expect(localStorage.getItem('locale')).toBe('de');
    });
});
