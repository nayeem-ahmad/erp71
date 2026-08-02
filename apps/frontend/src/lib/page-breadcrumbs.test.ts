import { projectChildBreadcrumbs } from './page-breadcrumbs';

const PROJECT = { id: 'p1', code: 'PRJ-0001', name: 'Project 1' };

describe('projectChildBreadcrumbs', () => {
    it('puts the project between Projects and the page, linked back to it', () => {
        expect(projectChildBreadcrumbs('Home', 'Projects', PROJECT, 'Board')).toEqual([
            { label: 'Home', href: '/dashboard' },
            { label: 'Projects', href: '/projects' },
            { label: 'PRJ-0001 · Project 1', href: '/projects/p1' },
            { label: 'Board' },
        ]);
    });

    it('drops the project segment rather than rendering a dead link while it loads', () => {
        // The board and backlog paint before their project fetch resolves, and
        // that fetch is allowed to fail without blocking the page — a placeholder
        // crumb here would be a link to nowhere.
        expect(projectChildBreadcrumbs('Home', 'Projects', null, 'Backlog')).toEqual([
            { label: 'Home', href: '/dashboard' },
            { label: 'Projects', href: '/projects' },
            { label: 'Backlog' },
        ]);
    });

    it('always leaves a route back to the projects list', () => {
        for (const project of [PROJECT, null]) {
            const trail = projectChildBreadcrumbs('Home', 'Projects', project, 'Board');
            expect(trail.filter((c) => c.href)).toEqual(
                expect.arrayContaining([{ label: 'Projects', href: '/projects' }]),
            );
            // The current page is the tail and is never a link.
            expect(trail[trail.length - 1].href).toBeUndefined();
        }
    });
});
