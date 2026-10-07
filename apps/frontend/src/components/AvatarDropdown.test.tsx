import { fireEvent, render, screen } from '@testing-library/react';
import AvatarDropdown from './AvatarDropdown';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/contexts/TenantLocaleContext', () => ({
    useTenantLocales: jest.fn(),
}));

const { useTenantLocales } = jest.requireMock('@/contexts/TenantLocaleContext') as {
    useTenantLocales: jest.Mock;
};

describe('AvatarDropdown', () => {
    beforeEach(() => {
        useTenantLocales.mockReturnValue({ allowedLocales: ['en', 'bn'], showLanguageSwitcher: true });
    });

    it('carries the language choice, which no longer has a header control of its own', () => {
        render(<AvatarDropdown userName="Rahim Uddin" />);

        expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
    });

    it('leaves the language row out when the workspace has one language', () => {
        useTenantLocales.mockReturnValue({ allowedLocales: ['en'], showLanguageSwitcher: false });
        render(<AvatarDropdown userName="Rahim Uddin" />);

        expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeInTheDocument();
    });

    it('opens support from the menu and closes the menu behind it', () => {
        const onOpenSupport = jest.fn();
        render(<AvatarDropdown userName="Rahim Uddin" onOpenSupport={onOpenSupport} />);

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('button', { name: 'Support' }));

        expect(onOpenSupport).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'User menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps the closed menu out of the tab order', () => {
        render(<AvatarDropdown userName="Rahim Uddin" onOpenSupport={jest.fn()} />);
        const select = screen.getByRole('combobox', { name: 'Language' });

        expect(select.closest('[inert]')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        expect(select.closest('[inert]')).toBeNull();
    });

    it('has no support item when support and feedback are both off', () => {
        render(<AvatarDropdown userName="Rahim Uddin" />);

        expect(screen.queryByRole('button', { name: 'Support' })).not.toBeInTheDocument();
    });
});
