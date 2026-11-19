import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrandingProvider } from './branding';
import { styleFor, useUiStyle } from './ui-theme';

jest.mock('./api', () => ({
    fetchWithAuth: jest.fn(),
}));

import { fetchWithAuth } from './api';
const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

function Probe() {
    const { theme, polished, colorful } = useUiStyle();
    return <p data-testid="probe">{`${theme} polished=${polished} colorful=${colorful}`}</p>;
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    delete document.documentElement.dataset.uiTheme;
});

describe('styleFor', () => {
    it('reads CLASSIC as neither polished nor colorful', () => {
        expect(styleFor('CLASSIC')).toEqual({ theme: 'CLASSIC', polished: false, colorful: false });
    });

    it('reads POLISHED as polished only', () => {
        expect(styleFor('POLISHED')).toEqual({ theme: 'POLISHED', polished: true, colorful: false });
    });

    it('builds COLORFUL on top of POLISHED', () => {
        expect(styleFor('COLORFUL')).toEqual({ theme: 'COLORFUL', polished: true, colorful: true });
    });
});

describe('useUiStyle', () => {
    it('is CLASSIC outside a provider, so tests and public pages keep the original markup', () => {
        render(<Probe />);
        expect(screen.getByTestId('probe')).toHaveTextContent('CLASSIC polished=false colorful=false');
    });

    it('takes the style from the workspace branding', async () => {
        sessionStorage.setItem('tenant_id', 't1');
        mockFetchWithAuth.mockResolvedValue({ ui_theme: 'COLORFUL' });
        render(<BrandingProvider><Probe /></BrandingProvider>);

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('COLORFUL'));
        expect(document.documentElement.dataset.uiTheme).toBe('colorful');
        // Remembered for this workspace, so the next load paints it straight away.
        expect(localStorage.getItem('erp71.ui_theme.t1')).toBe('COLORFUL');
    });

    it('paints the remembered style before the branding request answers', () => {
        sessionStorage.setItem('tenant_id', 't1');
        localStorage.setItem('erp71.ui_theme.t1', 'POLISHED');
        mockFetchWithAuth.mockReturnValue(new Promise(() => {}));
        render(<BrandingProvider><Probe /></BrandingProvider>);

        expect(screen.getByTestId('probe')).toHaveTextContent('POLISHED');
    });

    it('keeps each workspace’s style to itself', () => {
        sessionStorage.setItem('tenant_id', 't2');
        localStorage.setItem('erp71.ui_theme.t1', 'COLORFUL');
        mockFetchWithAuth.mockReturnValue(new Promise(() => {}));
        render(<BrandingProvider><Probe /></BrandingProvider>);

        expect(screen.getByTestId('probe')).toHaveTextContent('CLASSIC');
    });

    it('falls back to CLASSIC when the stored value is not a style', async () => {
        sessionStorage.setItem('tenant_id', 't1');
        mockFetchWithAuth.mockResolvedValue({ ui_theme: 'NEON' });
        render(<BrandingProvider><Probe /></BrandingProvider>);

        await waitFor(() => expect(document.documentElement.dataset.uiTheme).toBe('classic'));
        expect(screen.getByTestId('probe')).toHaveTextContent('CLASSIC');
    });
});
