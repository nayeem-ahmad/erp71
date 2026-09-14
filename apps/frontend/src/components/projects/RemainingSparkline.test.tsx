import { render, screen } from '@testing-library/react';
import RemainingSparkline from './RemainingSparkline';
import type { RemainingPoint } from './RemainingHoursChart';

jest.mock('@/lib/format', () => ({ getActiveTimeZone: () => 'UTC' }));

const labels = { title: 'Remaining', remaining: 'remaining', hover: 'hover for detail' };

const point = (over: Partial<RemainingPoint> & { changed_at: string }): RemainingPoint => ({
    id: over.changed_at,
    previous_hours: null,
    new_hours: '0',
    delta: '0',
    source: 'TIME_LOGGED',
    ...over,
});

const draw = (history: RemainingPoint[]) =>
    render(<RemainingSparkline history={history} labels={labels} dateLocale="en-GB" />);

describe('RemainingSparkline', () => {
    it('draws nothing until there are two readings', () => {
        // One change is a fact, not a trend — and the full chart applies the
        // same floor, so the two cannot disagree about when a shape exists.
        const { container } = draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '8' }),
        ]);

        expect(container.querySelector('svg')).toBeNull();
    });

    it('draws nothing at all when the task has no history', () => {
        const { container } = draw([]);
        expect(container.querySelector('svg')).toBeNull();
    });

    it('steps rather than slopes between readings', () => {
        // The log records the moments the figure CHANGED; between two rows it
        // sat still. A sloped line would draw progress nobody made.
        const { container } = draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '8', previous_hours: '10' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '6', delta: '-2' }),
        ]);

        const d = container.querySelector('path')?.getAttribute('d') ?? '';
        // A step is horizontal runs and vertical jumps: every segment shares an
        // x or a y with the point before it. A diagonal shares neither.
        const points = [...d.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map((m) => [
            Number(m[1]),
            Number(m[2]),
        ]);
        expect(points.length).toBeGreaterThan(2);
        for (let i = 1; i < points.length; i += 1) {
            const sharesAxis =
                points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1];
            expect(sharesAxis).toBe(true);
        }
    });

    it('names the latest figure for a screen reader', () => {
        draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '8', previous_hours: '10' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '6', delta: '-2' }),
        ]);

        expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Remaining: 6h remaining');
    });

    it('gives every run a hover title carrying its figure', () => {
        const { container } = draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '8', previous_hours: '10' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '6', delta: '-2' }),
        ]);

        const titles = [...container.querySelectorAll('title')].map((t) => t.textContent ?? '');
        expect(titles.length).toBeGreaterThan(0);
        expect(titles.some((text) => text.includes('8h remaining'))).toBe(true);
    });

    it('reports the change alongside the figure', () => {
        const { container } = draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '8', previous_hours: '10' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '6', delta: '-2' }),
        ]);

        const titles = [...container.querySelectorAll('title')].map((t) => t.textContent ?? '');
        expect(titles.some((text) => text.includes('(-2)'))).toBe(true);
    });

    it('marks work added with a sign, not a bare number', () => {
        const { container } = draw([
            point({ changed_at: '2026-09-11T09:00:00.000Z', new_hours: '4', previous_hours: '6' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '9', delta: '5' }),
        ]);

        const titles = [...container.querySelectorAll('title')].map((t) => t.textContent ?? '');
        expect(titles.some((text) => text.includes('(+5)'))).toBe(true);
    });

    it('survives a row whose timestamp is unusable', () => {
        const { container } = draw([
            point({ changed_at: 'not-a-date', new_hours: '8' }),
            point({ changed_at: '2026-09-12T09:00:00.000Z', new_hours: '6' }),
        ]);

        // One usable row left, which is below the floor — so nothing is drawn
        // rather than a chart built on a NaN axis.
        expect(container.querySelector('svg')).toBeNull();
    });
});
