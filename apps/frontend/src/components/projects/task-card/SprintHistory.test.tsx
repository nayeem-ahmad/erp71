import { render, screen } from '@testing-library/react';
import SprintHistory, { hasSprintHistory } from './SprintHistory';
import type { SprintStay } from './model';

const stay = (id: string, name: string, over: Partial<SprintStay> = {}): SprintStay => ({
    added_at: '2026-08-02T03:00:00.000Z',
    removed_at: '2026-08-13T17:59:00.000Z',
    outcome: 'CARRIED_OVER',
    sprint: { id, name, status: 'COMPLETED' },
    ...over,
});

describe('SprintHistory', () => {
    it('lists every sprint the task was attempted in, oldest first, the current one marked', () => {
        render(
            <SprintHistory
                stays={[
                    stay('s7', 'Sprint 7'),
                    stay('s8', 'Sprint 8'),
                    stay('s9', 'Sprint 9', { removed_at: null, outcome: null, sprint: { id: 's9', name: 'Sprint 9', status: 'ACTIVE' } }),
                ]}
            />,
        );

        const links = screen.getAllByRole('link');
        // The outcome is spoken too, not only shown on hover.
        expect(links.map((link) => link.textContent)).toEqual([
            'Sprint 7 (Carried over to the next sprint)',
            'Sprint 8 (Carried over to the next sprint)',
            'Sprint 9 (Current sprint)',
        ]);
        expect(links[0]).toHaveAttribute('href', '/projects/sprints/s7');
        expect(links[0]).toHaveAttribute('title', 'Carried over to the next sprint');
        expect(links[2]).toHaveAttribute('aria-current', 'true');
        expect(links[2]).toHaveAttribute('title', 'Current sprint');
    });

    it('names how each past stay ended', () => {
        render(
            <SprintHistory
                stays={[
                    stay('s1', 'Sprint 1', { outcome: 'RETURNED_TO_BACKLOG' }),
                    stay('s2', 'Sprint 2', { outcome: 'REMOVED' }),
                    stay('s3', 'Sprint 3', { outcome: 'DONE' }),
                ]}
            />,
        );
        expect(screen.getByRole('link', { name: /Sprint 1/ })).toHaveAttribute('title', 'Returned to the backlog');
        expect(screen.getByRole('link', { name: /Sprint 2/ })).toHaveAttribute('title', 'Taken out of the sprint');
        expect(screen.getByRole('link', { name: /Sprint 3/ })).toHaveAttribute('title', 'Finished in this sprint');
    });
});

describe('hasSprintHistory', () => {
    it('is false with nothing, or with only the current sprint — the Sprint field already says that', () => {
        expect(hasSprintHistory(undefined)).toBe(false);
        expect(hasSprintHistory([])).toBe(false);
        expect(hasSprintHistory([stay('s9', 'Sprint 9', { removed_at: null, outcome: null })])).toBe(false);
    });

    it('is true once any stay has ended', () => {
        expect(hasSprintHistory([stay('s7', 'Sprint 7')])).toBe(true);
    });
});
