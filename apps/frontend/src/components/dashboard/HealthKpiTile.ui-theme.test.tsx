import React from 'react';
import { render, screen } from '@testing-library/react';
import { ShoppingBag } from 'lucide-react';
import type { UiTheme } from '@erp71/shared-types';
import { UiThemeContext } from '@/lib/ui-theme';
import { HealthKpiTile } from './HealthKpiTile';

function renderTile(theme: UiTheme, delta = '▲ 14%', positive = true) {
    return render(
        <UiThemeContext.Provider value={theme}>
            <HealthKpiTile
                title="Sales"
                value="৳ 3,46,400"
                delta={delta}
                deltaPositive={positive}
                deltaContext="vs last week"
                points={[1, 3, 2, 4]}
                tone="emerald"
                icon={ShoppingBag}
            />
        </UiThemeContext.Provider>,
    );
}


describe('HealthKpiTile styles', () => {
    it('CLASSIC keeps the original caps label and white card', () => {
        renderTile('CLASSIC');
        expect(screen.getByText('Sales')).toHaveClass('uppercase');
        expect(screen.getByText('▲ 14%')).toBeInTheDocument();
        expect(screen.getByTestId('sparkline-endpoint')).toBeInTheDocument();
    });

    it('POLISHED uses a sentence-case label and a change badge without the text arrow', () => {
        renderTile('POLISHED');
        expect(screen.getByText('Sales')).not.toHaveClass('uppercase');
        expect(screen.getByText('14%')).toHaveClass('bg-success-light');
    });

    it('COLORFUL paints the card in its tone with a white line and no end dot', () => {
        renderTile('COLORFUL');
        const tile = screen.getByText('Sales').closest('.bg-gradient-to-br');
        expect(tile).toHaveClass('from-emerald-500');
        expect(screen.getByTestId('sparkline-line')).toHaveClass('stroke-white');
        expect(screen.queryByTestId('sparkline-endpoint')).toBeNull();
    });

    it('COLORFUL marks a fall with a darker chip, since the card colour carries no meaning', () => {
        renderTile('COLORFUL', '▼ 82%', false);
        expect(screen.getByText('82%')).toHaveClass('bg-black/25');
    });
});

