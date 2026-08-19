import { render, screen } from '@testing-library/react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDate } from '@/lib/format';
import { createdAtColumn } from './created-at-column';

const helper = createColumnHelper<{ created_at: string }>();
const STAMP = '2026-08-19T10:15:00.000Z';

describe('createdAtColumn', () => {
    it('sorts on created_at and is visible on desktop', () => {
        const column = createdAtColumn(helper, { header: 'Created', locale: 'en' });
        expect(column.id).toBe('created_at');
        expect(column.header).toBe('Created');
        expect(column.enableSorting).not.toBe(false);
        expect(column.meta).toEqual({ hideOnMobile: true });
    });

    it('renders the calendar date and a clock time, not date-only', () => {
        const column = createdAtColumn(helper, { header: 'Created', locale: 'en' });
        const cell = column.cell as (info: { getValue: () => string }) => React.ReactNode;
        render(<>{cell({ getValue: () => STAMP })}</>);
        expect(screen.getByText(formatDate(STAMP, 'en'))).toBeInTheDocument();
        expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    });
});
