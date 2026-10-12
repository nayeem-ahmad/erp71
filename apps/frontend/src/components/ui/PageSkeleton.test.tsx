import { render, screen } from '@testing-library/react';

// The real context, not jest.setup's English-only stub: the label has to come
// from the reader's dictionary.
jest.unmock('@/lib/i18n');

import { I18nProvider } from '@/lib/i18n';
import { loadMessages } from '@/lib/localization/load-messages';
import { PageSkeleton, SkeletonBar } from './PageSkeleton';

describe('PageSkeleton', () => {
    it('says "Loading" to a screen reader and hides the bars from it', () => {
        render(<PageSkeleton />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(screen.getByTestId('page-skeleton')).toHaveAttribute('aria-hidden', 'true');
    });

    it('says it in the reader\'s language', async () => {
        // Loaded first, so `I18nProvider` finds the dictionary settled and
        // renders without suspending; `<html lang>` as the server marks it, or
        // the provider's mount effect falls back to jsdom's English.
        await loadMessages('bn');
        document.documentElement.lang = 'bn';
        try {
            render(
                <I18nProvider initialLocale="bn">
                    <PageSkeleton />
                </I18nProvider>,
            );

            expect(screen.getByRole('status')).toHaveTextContent('লোড হচ্ছে...');
        } finally {
            document.documentElement.lang = '';
        }
    });

    it('sits in the same PageShell as a real page, so the outline lands where the page will', () => {
        const { container } = render(<PageSkeleton />);

        expect(container.firstElementChild).toHaveClass('overflow-y-auto', 'h-full', 'bg-canvas', 'p-3', 'md:p-4');
    });

    it('draws a list by default: two header actions, then a table', () => {
        render(<PageSkeleton rows={5} />);
        const skeleton = screen.getByTestId('page-skeleton');

        expect(skeleton).toHaveAttribute('data-body', 'table');
        expect(skeleton.querySelectorAll('.h-8.w-20')).toHaveLength(2);
        // Header row plus five body rows, each a five-column grid.
        expect(skeleton.querySelectorAll('.grid.md\\:grid-cols-5')).toHaveLength(6);
    });

    it('hides the secondary table columns below md, so it never scrolls sideways on a phone', () => {
        render(<PageSkeleton rows={1} />);
        const firstRow = screen.getByTestId('page-skeleton').querySelector('.grid.md\\:grid-cols-5')!;
        const columns = Array.from(firstRow.children);

        expect(columns.filter((column) => column.classList.contains('hidden'))).toHaveLength(2);
    });

    it('adds the KPI strip above the table only when asked', () => {
        const { rerender } = render(<PageSkeleton />);
        expect(screen.getByTestId('page-skeleton').querySelector('.xl\\:grid-cols-4')).toBeNull();

        rerender(<PageSkeleton stats />);
        expect(screen.getByTestId('page-skeleton').querySelector('.xl\\:grid-cols-4')).not.toBeNull();
    });

    it('draws a dashboard as tiles and panels, with no table and no actions unless asked', () => {
        render(<PageSkeleton body="dashboard" />);
        const skeleton = screen.getByTestId('page-skeleton');

        expect(skeleton.querySelector('.xl\\:grid-cols-4')!.children).toHaveLength(4);
        expect(skeleton.querySelector('.lg\\:grid-cols-2')!.children).toHaveLength(2);
        expect(skeleton.querySelector('.md\\:grid-cols-5')).toBeNull();
        expect(skeleton.querySelectorAll('.h-8.w-20')).toHaveLength(0);
    });

    it('draws a report as a filter bar over one line per row', () => {
        render(<PageSkeleton body="report" rows={4} />);
        const skeleton = screen.getByTestId('page-skeleton');

        expect(skeleton.querySelectorAll('.w-36')).toHaveLength(3);
        expect(skeleton.querySelectorAll('.justify-between.gap-4')).toHaveLength(4);
    });
});

describe('SkeletonBar', () => {
    it('pulses, and is a shade darker on the grey canvas than inside a card', () => {
        const { container, rerender } = render(<SkeletonBar className="h-3 w-10" />);
        expect(container.firstElementChild).toHaveClass('animate-pulse', 'bg-gray-100', 'h-3', 'w-10');

        rerender(<SkeletonBar onCanvas />);
        expect(container.firstElementChild).toHaveClass('bg-gray-200');
        expect(container.firstElementChild).not.toHaveClass('bg-gray-100');
    });
});
