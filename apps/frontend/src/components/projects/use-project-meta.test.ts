import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectMeta, type ProjectMeta } from './use-project-meta';

const getProjectColumns = jest.fn();
const getProject = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectColumns: (...args: unknown[]) => getProjectColumns(...args),
        getProject: (...args: unknown[]) => getProject(...args),
    },
}));

const withMembers = (members: unknown[]) => ({ id: 'p1', members });

/**
 * `load` resolves the fetch and bumps a version to redraw the rows that were
 * waiting on it, so every call is a state update and belongs inside `act`.
 */
const meta = () => {
    const { result } = renderHook(() => useProjectMeta());
    return {
        peek: (id: string) => result.current.peek(id),
        forget: (id: string) => result.current.forget(id),
        load: async (id: string) => {
            let loaded!: ProjectMeta;
            await act(async () => {
                loaded = await result.current.load(id);
            });
            return loaded;
        },
        loadBoth: async (id: string) => {
            await act(async () => {
                await Promise.all([result.current.load(id), result.current.load(id)]);
            });
        },
    };
};

beforeEach(() => {
    jest.clearAllMocks();
    getProjectColumns.mockResolvedValue([{ id: 'c1', name: 'To do', category: 'TODO' }]);
    getProject.mockResolvedValue(withMembers([{ user: { id: 'u1', name: 'Karim', email: 'k@x.com' } }]));
});

describe('useProjectMeta', () => {
    it('turns a project roster into picker options', async () => {
        const project = meta();

        const loaded = await project.load('p1');
        expect(loaded.assignees).toEqual([{ value: 'user:u1', label: 'Karim' }]);
        expect(loaded.failed).toBe(false);
    });

    it('falls back to the email when a member has no name', async () => {
        getProject.mockResolvedValue(withMembers([{ user: { id: 'u1', name: null, email: 'k@x.com' } }]));
        const project = meta();

        const loaded = await project.load('p1');
        expect(loaded.assignees).toEqual([{ value: 'user:u1', label: 'k@x.com' }]);
    });

    it('reads a project once however many rows ask for it', async () => {
        const project = meta();

        await project.loadBoth('p1');
        await project.load('p1');

        expect(getProject).toHaveBeenCalledTimes(1);
    });

    /**
     * A read that fails and a project nobody is on were the same value until
     * people reported the Assignee picker as broken — both left `assignees`
     * empty and neither said why.
     */
    describe('a roster that could not be read', () => {
        it('is marked failed rather than reported as an empty team', async () => {
            getProject.mockRejectedValue(new Error('403'));
            const project = meta();

            const loaded = await project.load('p1');
            expect(loaded.failed).toBe(true);
            expect(loaded.assignees).toEqual([]);
        });

        it('still returns the columns, which loaded fine', async () => {
            getProject.mockRejectedValue(new Error('403'));
            const project = meta();

            const loaded = await project.load('p1');
            expect(loaded.columns).toHaveLength(1);
        });

        it('is visible to peek, so a picker can say what went wrong', async () => {
            getProject.mockRejectedValue(new Error('403'));
            const project = meta();

            await project.load('p1');
            await waitFor(() => expect(project.peek('p1')?.failed).toBe(true));
        });

        // Caching the failure would leave the picker empty for the life of the
        // page, and reopening it — the obvious thing to try — would do nothing.
        it('is retried on the next open', async () => {
            getProject.mockRejectedValueOnce(new Error('503'));
            const project = meta();

            expect((await project.load('p1')).failed).toBe(true);

            const second = await project.load('p1');
            expect(getProject).toHaveBeenCalledTimes(2);
            expect(second.failed).toBe(false);
            expect(second.assignees).toEqual([{ value: 'user:u1', label: 'Karim' }]);
        });

        it('stops retrying once it has succeeded', async () => {
            getProject.mockRejectedValueOnce(new Error('503'));
            const project = meta();

            await project.load('p1');
            await project.load('p1');
            await project.load('p1');

            expect(getProject).toHaveBeenCalledTimes(2);
        });
    });

    it('forgets a project after a write that can change its roster', async () => {
        const project = meta();

        await project.load('p1');
        project.forget('p1');
        await project.load('p1');

        expect(getProject).toHaveBeenCalledTimes(2);
    });
});
