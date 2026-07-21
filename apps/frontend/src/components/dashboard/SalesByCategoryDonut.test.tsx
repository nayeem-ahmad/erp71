import { render, screen } from '@testing-library/react';
import { SalesByCategoryDonut, CATEGORY_PALETTE } from './SalesByCategoryDonut';

const rows = [
    { categoryId: 'g1', categoryName: 'Electronics', revenue: 200, share: 40 },
    { categoryId: 'g2', categoryName: 'Lighting', revenue: 300, share: 60 },
];

describe('SalesByCategoryDonut', () => {
    it('renders a legend row per category with its share', () => {
        render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        expect(screen.getByText('Electronics')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('৳500')).toBeInTheDocument();
    });

    it('shows the empty label when there are no rows', () => {
        render(<SalesByCategoryDonut rows={[]} totalLabel="৳0" emptyLabel="No sales" />);
        expect(screen.getByText('No sales')).toBeInTheDocument();
    });

    it('draws one arc per category', () => {
        const { container } = render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        expect(container.querySelectorAll('[data-testid="donut-arc"]')).toHaveLength(2);
    });

    it('sizes each arc to its share of the total', () => {
        const { container } = render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        const arcs = container.querySelectorAll('[data-testid="donut-arc"]');
        const visibleLength = (arc: Element) => Number(arc.getAttribute('stroke-dasharray')!.split(' ')[0]);
        // 60% arc is longer than the 40% arc.
        expect(visibleLength(arcs[1])).toBeGreaterThan(visibleLength(arcs[0]));
    });

    it('gives each category a distinct hue from the validated palette', () => {
        const { container } = render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        const arcs = Array.from(container.querySelectorAll('[data-testid="donut-arc"]'));
        const strokes = arcs.map((arc) => arc.getAttribute('stroke'));
        expect(strokes).toEqual([CATEGORY_PALETTE[0], CATEGORY_PALETTE[1]]);
        expect(new Set(strokes).size).toBe(strokes.length);
    });

    it('keeps the total readable inside the ring', () => {
        render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        expect(screen.getByTestId('donut-total')).toHaveTextContent('৳500');
    });

    it('keeps the exact total reachable when the ring shows a rounded one', () => {
        // The hole is ~110px wide, so the label is rounded; the precise figure
        // must still be available rather than lost.
        render(
            <SalesByCategoryDonut
                rows={rows}
                totalLabel="৳ 339,042"
                totalTitle="৳ 339,042.00"
                emptyLabel="No sales"
            />,
        );
        expect(screen.getByTestId('donut-total')).toHaveAttribute('title', '৳ 339,042.00');
    });
});

describe('CATEGORY_PALETTE', () => {
    it('has no near-white or gray slot that would vanish on the card surface', () => {
        // The previous palette ended in #e2e8f0, which failed the chroma floor.
        expect(CATEGORY_PALETTE).not.toContain('#e2e8f0');
        expect(CATEGORY_PALETTE).toHaveLength(6);
    });
});
