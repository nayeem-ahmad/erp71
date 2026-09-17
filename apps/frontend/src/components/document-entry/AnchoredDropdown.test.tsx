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

/**
 * A menu wider than the control it hangs off, pinned near the right edge —
 * the paper-size picker in the entry layout's 320px sidebar.
 */
function EndAligned({ panelWidth }: { panelWidth: number }) {
    const anchorRef = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={anchorRef} data-testid="anchor" />
            <AnchoredDropdown anchorRef={anchorRef} matchAnchorWidth={false} align="end">
                <div style={{ width: panelWidth }}>80mm Thermal</div>
            </AnchoredDropdown>
        </div>
    );
}

function stubAnchor(left: number, width: number) {
    // jsdom gives every element a zero-sized box, so the anchor's geometry has
    // to be stated for the positioning maths to have anything to work with.
    Element.prototype.getBoundingClientRect = function () {
        if ((this as HTMLElement).dataset?.testid === 'anchor') {
            return { top: 500, bottom: 530, left, right: left + width, width, height: 30, x: left, y: 500, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
}

describe('AnchoredDropdown horizontal placement', () => {
    const realRect = Element.prototype.getBoundingClientRect;
    const realScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');

    afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect;
        if (realScrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', realScrollWidth);
    });

    function stubPanelWidth(width: number) {
        Object.defineProperty(Element.prototype, 'scrollWidth', {
            configurable: true,
            get() { return width; },
        });
    }

    it('hangs an end-aligned panel off the anchor\'s right edge', () => {
        // A 30px chevron at x=800 with a 160px menu, inside jsdom's 1024
        // viewport: the menu grows leftwards to stay under its trigger, and
        // there is room to do so without the clamp getting involved.
        stubAnchor(800, 30);
        stubPanelWidth(160);
        render(<EndAligned panelWidth={160} />);

        const panel = document.body.querySelector('.z-dropdown') as HTMLElement;
        // right edge (830) - width (160) = 670
        expect(panel.style.left).toBe('670px');
    });

    it('pulls a right-aligned panel back inside the viewport', () => {
        // The clamp, which is what stops the reported clipping recurring: a
        // panel hung off an anchor near the right edge would otherwise sit
        // partly outside the viewport.
        stubAnchor(1000, 30);
        stubPanelWidth(160);
        render(<EndAligned panelWidth={160} />);

        const panel = document.body.querySelector('.z-dropdown') as HTMLElement;
        const left = parseFloat(panel.style.left);
        expect(left + 160).toBeLessThanOrEqual(window.innerWidth);
        expect(panel.style.left).toBe(`${window.innerWidth - 160 - 8}px`);
    });

    it('clamps a panel that would run off the left edge', () => {
        // Anchor near the left edge: right-aligning would put the panel at a
        // negative offset, which is the clipping bug in another form.
        stubAnchor(20, 30);
        stubPanelWidth(300);
        render(<EndAligned panelWidth={300} />);

        const panel = document.body.querySelector('.z-dropdown') as HTMLElement;
        expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
        expect(panel.style.left).toBe('8px');
    });

    it('never lets a panel exceed the viewport width', () => {
        stubAnchor(1040, 30);
        stubPanelWidth(4000);
        render(<EndAligned panelWidth={4000} />);

        const panel = document.body.querySelector('.z-dropdown') as HTMLElement;
        // 1024 is jsdom's default viewport; the panel keeps an 8px gutter.
        expect(panel.style.maxWidth).toBe(`${window.innerWidth - 16}px`);
    });
});
