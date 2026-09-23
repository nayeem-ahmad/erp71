import { render } from '@testing-library/react';
import TenantLocaleSync from './TenantLocaleSync';

const setLocale = jest.fn();
let currentLocale = 'bn';

jest.mock('@/lib/i18n', () => ({
    useI18n: () => ({ locale: currentLocale, setLocale }),
}));

describe('TenantLocaleSync', () => {
    beforeEach(() => {
        setLocale.mockClear();
        currentLocale = 'bn';
    });

    it('leaves the locale alone while the tenant is still loading', () => {
        render(<TenantLocaleSync tenant={null} />);
        render(<TenantLocaleSync tenant={undefined} />);
        expect(setLocale).not.toHaveBeenCalled();
    });

    it('keeps Bangla when the loaded tenant has it enabled', () => {
        render(<TenantLocaleSync tenant={{ localization_enabled: true, secondary_locale: 'bn' }} />);
        expect(setLocale).not.toHaveBeenCalled();
    });

    it('falls back to English when the loaded tenant does not allow the locale', () => {
        render(<TenantLocaleSync tenant={{ localization_enabled: false, secondary_locale: null }} />);
        expect(setLocale).toHaveBeenCalledWith('en');
    });

    it('does not reset the locale on the render before the tenant arrives', () => {
        const { rerender } = render(<TenantLocaleSync tenant={null} />);
        rerender(<TenantLocaleSync tenant={{ localization_enabled: true, secondary_locale: 'bn' }} />);
        expect(setLocale).not.toHaveBeenCalled();
    });
});
