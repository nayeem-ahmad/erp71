import { render, screen } from '@testing-library/react';
import { FormFooter } from './FormFooter';

describe('FormFooter', () => {
    it('renders children', () => {
        render(
            <FormFooter>
                <button>Cancel</button>
                <button>Save</button>
            </FormFooter>,
        );
        expect(screen.getByText('Cancel')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('applies right-aligned footer classes', () => {
        const { container } = render(
            <FormFooter>
                <button>Save</button>
            </FormFooter>,
        );
        const footer = container.firstElementChild;
        expect(footer).toHaveClass('flex');
        expect(footer).toHaveClass('justify-end');
        expect(footer).toHaveClass('gap-2');
        expect(footer).toHaveClass('border-t');
    });
});
