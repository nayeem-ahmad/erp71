import { render, screen } from '@testing-library/react';
import { FormGrid } from './FormGrid';

describe('FormGrid', () => {
    it('renders children inside a grid container', () => {
        render(
            <FormGrid>
                <div>Field A</div>
                <div>Field B</div>
            </FormGrid>,
        );
        expect(screen.getByText('Field A')).toBeInTheDocument();
        expect(screen.getByText('Field B')).toBeInTheDocument();
    });

    it('applies the grid layout classes', () => {
        const { container } = render(
            <FormGrid>
                <div>Field A</div>
            </FormGrid>,
        );
        const grid = container.firstElementChild;
        expect(grid).toHaveClass('grid');
        expect(grid).toHaveClass('gap-3');
        expect(grid).toHaveClass('sm:grid-cols-2');
    });

    it('FormGrid.Full applies a full-width span class', () => {
        const { container } = render(
            <FormGrid>
                <FormGrid.Full>
                    <div>Wide field</div>
                </FormGrid.Full>
            </FormGrid>,
        );
        const full = container.querySelector('[class*="col-span-2"]');
        expect(full).toHaveClass('sm:col-span-2');
        expect(screen.getByText('Wide field')).toBeInTheDocument();
    });
});
