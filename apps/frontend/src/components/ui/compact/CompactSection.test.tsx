import { render, screen } from '@testing-library/react';
import CompactSection from './CompactSection';

describe('CompactSection', () => {
    // Thirty-odd pages use the caption form; it must not move.
    it('draws a plain title as the small grey caption it always was', () => {
        render(<CompactSection title="Sales today">Body</CompactSection>);

        const caption = screen.getByText('Sales today');
        expect(caption.tagName).toBe('P');
        expect(caption.className).toMatch(/text-xs/);
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('makes the title a heading when the card is named by it', () => {
        render(
            <CompactSection title="Details" titleStyle="heading">
                Body
            </CompactSection>,
        );

        expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    });

    it('takes the heading level it is given', () => {
        render(
            <CompactSection title="Details" titleStyle="heading" headingLevel={3}>
                Body
            </CompactSection>,
        );

        expect(screen.getByRole('heading', { level: 3, name: 'Details' })).toBeInTheDocument();
    });

    it('puts actions on the title row', () => {
        render(
            <CompactSection title="Checklist" titleStyle="heading" actions={<button type="button">Add item</button>}>
                Body
            </CompactSection>,
        );

        const heading = screen.getByRole('heading', { name: 'Checklist' });
        const button = screen.getByRole('button', { name: 'Add item' });
        // One row: the heading's wrapper and the actions' wrapper share a parent.
        expect(heading.parentElement?.parentElement).toContainElement(button);
        expect(screen.getByText('Body')).toBeInTheDocument();
    });
});
