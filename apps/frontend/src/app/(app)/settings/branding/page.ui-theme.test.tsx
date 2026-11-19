import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrandingSettingsPage from './page';
import { SetUiSidebarContext, SetUiThemeContext } from '@/lib/ui-theme';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/settings/branding',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

import { fetchWithAuth } from '@/lib/api';
const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

function renderPage(stored?: string, storedSidebar?: string) {
    mockFetchWithAuth.mockImplementation((_url: string, options?: any) =>
        Promise.resolve(options?.method === 'PATCH' ? {} : { brand_business_name: 'My Shop', ui_theme: stored, ui_sidebar: storedSidebar }),
    );
    const applyUiTheme = jest.fn();
    const applyUiSidebar = jest.fn();
    render(
        <SetUiThemeContext.Provider value={applyUiTheme}>
            <SetUiSidebarContext.Provider value={applyUiSidebar}>
                <BrandingSettingsPage />
            </SetUiSidebarContext.Provider>
        </SetUiThemeContext.Provider>,
    );
    return { applyUiTheme, applyUiSidebar };
}

const patchBody = () => {
    const call = mockFetchWithAuth.mock.calls.find((c) => c[1]?.method === 'PATCH');
    return JSON.parse(String(call?.[1]?.body ?? '{}'));
};

beforeEach(() => jest.clearAllMocks());

describe('Branding › interface style', () => {
    it('offers the three styles, with Classic chosen for a workspace that never picked one', async () => {
        renderPage(undefined);
        const classic = await screen.findByRole('radio', { name: 'Classic' });
        expect(screen.getByRole('radio', { name: 'Polished' })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: 'Colorful' })).not.toBeChecked();
        expect(classic).toBeChecked();
        expect(screen.getByRole('group', { name: 'Interface style' })).toBeInTheDocument();
    });

    it('shows the stored style as chosen and current', async () => {
        renderPage('POLISHED');
        const polished = await screen.findByRole('radio', { name: 'Polished' });
        await waitFor(() => expect(polished).toBeChecked());
        expect(polished.closest('label')).toHaveTextContent('Current');
    });

    it('saves the chosen style and switches the app to it straight away', async () => {
        const { applyUiTheme } = renderPage('CLASSIC');
        fireEvent.click(await screen.findByRole('radio', { name: 'Colorful' }));
        // Picking alone changes nothing until the form is saved.
        expect(applyUiTheme).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Save Branding' }));

        await waitFor(() => expect(applyUiTheme).toHaveBeenCalledWith('COLORFUL'));
        expect(patchBody()).toEqual(expect.objectContaining({ ui_theme: 'COLORFUL' }));
        expect(screen.getByRole('radio', { name: 'Colorful' }).closest('label')).toHaveTextContent('Current');
    });

    it('treats an unknown stored value as Classic', async () => {
        renderPage('NEON');
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Classic' })).toBeChecked());
    });

    it('offers a light or dark navy sidebar, light by default', async () => {
        renderPage('CLASSIC');
        expect(await screen.findByRole('radio', { name: 'Light' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Dark navy' })).not.toBeChecked();
        expect(screen.getByRole('group', { name: 'Sidebar' })).toBeInTheDocument();
    });

    it('saves the navy sidebar alongside the style and applies both', async () => {
        const { applyUiTheme, applyUiSidebar } = renderPage('POLISHED', 'LIGHT');
        fireEvent.click(await screen.findByRole('radio', { name: 'Dark navy' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Branding' }));

        await waitFor(() => expect(applyUiSidebar).toHaveBeenCalledWith('NAVY'));
        expect(applyUiTheme).toHaveBeenCalledWith('POLISHED');
        expect(patchBody()).toEqual(expect.objectContaining({ ui_theme: 'POLISHED', ui_sidebar: 'NAVY' }));
    });
});
