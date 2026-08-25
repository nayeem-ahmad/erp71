import { renderHook, waitFor } from '@testing-library/react';
import { useTeamMemberOptions } from './use-team-member-options';

jest.mock('@/lib/api', () => ({
    api: { getTeamMembers: jest.fn(), getMe: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

describe('useTeamMemberOptions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
        api.getMe.mockResolvedValue({ id: 'user-1' });
    });

    it('relabels the signed-in user as Me and pins them first', async () => {
        const { result } = renderHook(() => useTeamMemberOptions('Me'));

        await waitFor(() => expect(result.current.options).toHaveLength(2));
        expect(result.current.options[0]).toEqual({ id: 'user-1', label: 'Me' });
        expect(result.current.options[1]).toEqual({ id: 'user-2', label: 'Rifat' });
        expect(result.current.currentUserId).toBe('user-1');
    });

    it('reads the id from any of the three shapes a member row uses', async () => {
        api.getTeamMembers.mockResolvedValue([
            { user_id: 'user-2', name: 'Rifat' },
            { user: { id: 'user-3', name: 'Sadia' } },
        ]);
        api.getMe.mockResolvedValue({ id: 'nobody' });

        const { result } = renderHook(() => useTeamMemberOptions('Me'));

        await waitFor(() => expect(result.current.options).toHaveLength(2));
        expect(result.current.options.map((o) => o.id)).toEqual(['user-2', 'user-3']);
        expect(result.current.options[1].label).toBe('Sadia');
    });

    it('drops rows carrying no user id at all', async () => {
        api.getTeamMembers.mockResolvedValue([{ name: 'Ghost' }, { userId: 'user-2', name: 'Rifat' }]);

        const { result } = renderHook(() => useTeamMemberOptions('Me'));

        await waitFor(() => expect(result.current.options).toHaveLength(1));
        expect(result.current.options[0].id).toBe('user-2');
    });

    it('survives both calls failing', async () => {
        api.getTeamMembers.mockRejectedValue(new Error('nope'));
        api.getMe.mockRejectedValue(new Error('nope'));

        const { result } = renderHook(() => useTeamMemberOptions('Me'));

        await waitFor(() => expect(result.current.currentUserId).toBeNull());
        expect(result.current.options).toEqual([]);
    });
});
