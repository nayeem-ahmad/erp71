import { act, fireEvent, render, screen } from '@testing-library/react';
import AvatarDropdown from './AvatarDropdown';
import { resetPageTimingViewerForTests, setPageTimingViewerIsStaff } from '@/lib/page-timing/viewer';

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

    describe('page timing switch', () => {
        afterEach(() => {
            resetPageTimingViewerForTests();
            window.localStorage.clear();
        });

        it('is not offered to a tenant user', () => {
            render(<AvatarDropdown userName="Rahim Uddin" />);
            expect(screen.queryByRole('switch', { name: 'Show page timing' })).not.toBeInTheDocument();
        });

        it('is offered to platform staff, off by default, and remembered on this device', () => {
            act(() => setPageTimingViewerIsStaff(true));
            render(<AvatarDropdown userName="Ops" />);
            fireEvent.click(screen.getByRole('button', { name: 'User menu' }));

            const toggle = screen.getByRole('switch', { name: 'Show page timing' });
            expect(toggle).toHaveAttribute('aria-checked', 'false');
            fireEvent.click(toggle);

            expect(toggle).toHaveAttribute('aria-checked', 'true');
            expect(window.localStorage.getItem('erp71:page-timing-visible')).toBe('1');
        });
    });
});
