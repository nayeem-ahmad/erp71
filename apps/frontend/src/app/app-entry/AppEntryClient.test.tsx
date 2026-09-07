import React from 'react';
import { render, waitFor } from '@testing-library/react';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace, push: jest.fn() }),
}));

const getAccessToken = jest.fn();

jest.mock('@/lib/session-store', () => ({
    getAccessToken: () => getAccessToken(),
}));

import AppEntryClient from './AppEntryClient';

beforeEach(() => {
    replace.mockReset();
    getAccessToken.mockReset();
});

describe('AppEntryClient', () => {
    it('continues to the dashboard when the browser holds a session', () => {
        getAccessToken.mockReturnValue('a-token');

        render(<AppEntryClient />);

        return waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    });

    it('sends a signed-out visitor to the login page', () => {
        getAccessToken.mockReturnValue(null);

        render(<AppEntryClient />);

        return waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    });

    it('shows a busy state while it decides', () => {
        getAccessToken.mockReturnValue(null);

        const { container } = render(<AppEntryClient />);

        expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
});
