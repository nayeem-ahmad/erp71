import { screen, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { renderWithQueryClient } from '@/test-utils/query-client';
import { fetchMe, invalidateMe, seedMe, useMe } from './use-me';

jest.mock('@/lib/api', () => ({
    api: { getMe: jest.fn() },
}));

const getMe = api.getMe as jest.Mock;

function Name({ label }: { label: string }) {
    const { data } = useMe();
    return <p>{`${label}: ${data?.name ?? '…'}`}</p>;
}

beforeEach(() => {
    getMe.mockReset();
});

it('serves every component that mounts together from one request', async () => {
    getMe.mockResolvedValue({ id: 'u1', name: 'Ada' });

    renderWithQueryClient(
        <>
            <Name label="shell" />
            <Name label="page" />
            <Name label="hook" />
        </>,
    );

    expect(await screen.findByText('shell: Ada')).toBeInTheDocument();
    expect(screen.getByText('page: Ada')).toBeInTheDocument();
    expect(screen.getByText('hook: Ada')).toBeInTheDocument();
    expect(getMe).toHaveBeenCalledTimes(1);
});

it('shares the request with an imperative read made at the same time', async () => {
    getMe.mockResolvedValue({ id: 'u1', name: 'Ada' });

    renderWithQueryClient(<Name label="shell" />);
    await expect(fetchMe()).resolves.toEqual({ id: 'u1', name: 'Ada' });

    expect(await screen.findByText('shell: Ada')).toBeInTheDocument();
    expect(getMe).toHaveBeenCalledTimes(1);
});

it('renders a seeded answer without asking again', async () => {
    seedMe({ id: 'u1', name: 'Seeded' });

    renderWithQueryClient(<Name label="shell" />);

    expect(screen.getByText('shell: Seeded')).toBeInTheDocument();
    expect(getMe).not.toHaveBeenCalled();
});

it('refetches what is on screen when invalidated', async () => {
    seedMe({ id: 'u1', name: 'Before' });
    getMe.mockResolvedValue({ id: 'u1', name: 'After' });

    renderWithQueryClient(<Name label="shell" />);
    await invalidateMe();

    await waitFor(() => expect(screen.getByText('shell: After')).toBeInTheDocument());
    expect(getMe).toHaveBeenCalledTimes(1);
});
