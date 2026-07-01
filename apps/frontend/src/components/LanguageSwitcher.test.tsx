import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LanguageSwitcher from './LanguageSwitcher';

jest.mock('../lib/api', () => ({
    api: {
        updateProfile: jest.fn(),
    },
}));

// Mock the i18n hook
const mockSetLocale = jest.fn();
jest.mock('../lib/i18n', () => ({
    useI18n: jest.fn(),
}));

jest.mock('@/contexts/TenantLocaleContext', () => ({
    useTenantLocales: jest.fn(),
}));

const mockLocales = [
    { code: 'en', nativeLabel: 'English' },
    { code: 'bn', nativeLabel: 'বাংলা' },
    { code: 'ms', nativeLabel: 'Bahasa Melayu' },
];

const mockT = {
    localeSwitcher: {
        title: 'Select language',
        label: 'Language',
    },
};

describe('LanguageSwitcher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { useI18n } = require('../lib/i18n');
        const { useTenantLocales } = require('@/contexts/TenantLocaleContext');
        useI18n.mockReturnValue({
            locale: 'en',
            locales: mockLocales,
            setLocale: mockSetLocale,
            t: mockT,
        });
        useTenantLocales.mockReturnValue({
            allowedLocales: ['en', 'bn', 'ms'],
            showLanguageSwitcher: true,
        });
        const { api } = require('../lib/api');
        api.updateProfile.mockResolvedValue({});
        // Clear access token so API update is not triggered by default
        localStorage.removeItem('access_token');
    });

    it('renders without crashing', () => {
        render(<LanguageSwitcher />);
    });

    it('renders nothing when language switching is disabled for the tenant', () => {
        const { useTenantLocales } = require('@/contexts/TenantLocaleContext');
        useTenantLocales.mockReturnValue({
            allowedLocales: ['en'],
            showLanguageSwitcher: false,
        });

        const { container } = render(<LanguageSwitcher />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the language select element', () => {
        render(<LanguageSwitcher />);
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders all locale options', () => {
        render(<LanguageSwitcher />);
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('বাংলা')).toBeInTheDocument();
        expect(screen.getByText('Bahasa Melayu')).toBeInTheDocument();
    });

    it('shows the current locale as selected', () => {
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        expect(select).toHaveValue('en');
    });

    it('shows label text', () => {
        render(<LanguageSwitcher />);
        // The label text "Language" is present (may be hidden on small screens)
        expect(screen.getByText('Language')).toBeInTheDocument();
    });

    it('calls setLocale when a different locale is selected', () => {
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'bn' } });
        expect(mockSetLocale).toHaveBeenCalledWith('bn');
    });

    it('calls setLocale with ms when Bahasa Melayu is selected', () => {
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'ms' } });
        expect(mockSetLocale).toHaveBeenCalledWith('ms');
    });

    it('does not call updateProfile when no access token', () => {
        const { api } = require('../lib/api');
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'bn' } });
        expect(api.updateProfile).not.toHaveBeenCalled();
    });

    it('calls updateProfile when access token is present', async () => {
        const { api } = require('../lib/api');
        localStorage.setItem('access_token', 'test-token');
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'bn' } });
        await waitFor(() => {
            expect(api.updateProfile).toHaveBeenCalledWith({ preferred_locale: 'bn' });
        });
        localStorage.removeItem('access_token');
    });

    it('has the correct aria-label on the select', () => {
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        expect(select).toHaveAttribute('aria-label', 'Language');
    });

    it('renders label with correct title attribute', () => {
        render(<LanguageSwitcher />);
        const label = screen.getByTitle('Select language');
        expect(label).toBeInTheDocument();
    });

    it('shows bn locale selected when locale is bn', () => {
        const { useI18n } = require('../lib/i18n');
        useI18n.mockReturnValue({
            locale: 'bn',
            locales: mockLocales,
            setLocale: mockSetLocale,
            t: mockT,
        });
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        expect(select).toHaveValue('bn');
    });

    it('does not call setLocale when an unknown locale value is selected', () => {
        render(<LanguageSwitcher />);
        const select = screen.getByRole('combobox');
        // Simulate selecting a value not in the locales list
        fireEvent.change(select, { target: { value: 'zz' } });
        // setLocale should not be called because selectedLocale would be undefined
        expect(mockSetLocale).not.toHaveBeenCalled();
    });
});
