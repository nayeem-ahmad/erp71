import { createRef, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import AnchoredDropdown from './AnchoredDropdown';

/** The shape the entry screens use: a panel hung off a field inside a clipping box. */
function Harness({ panelRef }: { panelRef?: React.RefObject<HTMLDivElement | null> }) {
    const anchorRef = useRef<HTMLInputElement>(null);
    return (
        <div data-testid="clipping-box" className="overflow-hidden">
            <input ref={anchorRef} aria-label="Product" />
            <AnchoredDropdown anchorRef={anchorRef} panelRef={panelRef}>
                <div>Soybean Oil 1L</div>
            </AnchoredDropdown>
        </div>
    );
}

describe('AnchoredDropdown', () => {
    it('renders the panel outside the box that would clip it', () => {
        render(<Harness />);

        const option = screen.getByText('Soybean Oil 1L');
        expect(option).toBeInTheDocument();
        // The whole point: the panel is a child of <body>, so an ancestor's
        // overflow or paint order cannot cut it off.
        expect(screen.getByTestId('clipping-box')).not.toContainElement(option);
        expect(document.body).toContainElement(option);
    });

    it('hands the panel element back so the owner can test clicks against it', () => {
        const panelRef = createRef<HTMLDivElement>();
        render(<Harness panelRef={panelRef} />);

        expect(panelRef.current).not.toBeNull();
        expect(panelRef.current).toContainElement(screen.getByText('Soybean Oil 1L'));
        expect(panelRef.current).toHaveStyle({ position: 'fixed' });
    });
});
