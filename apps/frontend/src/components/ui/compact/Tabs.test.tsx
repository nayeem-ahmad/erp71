import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Tabs, TabPanel } from './Tabs';

type K = 'one' | 'two' | 'three';

const TABS = [
    { key: 'one' as const, label: 'One', count: 3 },
    { key: 'two' as const, label: 'Two' },
    { key: 'three' as const, label: 'Three', count: 0 },
];

/** Mounts the strip with real state, the way a caller drives it. */
function Harness({ initial = null }: { initial?: K | null }) {
    const [value, setValue] = useState<K | null>(initial);
    return (
        <>
            <Tabs<K>
                tabs={TABS}
                value={value}
                onChange={setValue}
                idPrefix="t"
                label="Record"
            />
            <TabPanel tabKey="one" value={value} idPrefix="t">
                <p>panel one</p>
            </TabPanel>
            <TabPanel tabKey="two" value={value} idPrefix="t">
                <p>panel two</p>
            </TabPanel>
            <TabPanel tabKey="three" value={value} idPrefix="t">
                <p>panel three</p>
            </TabPanel>
        </>
    );
}

describe('Tabs', () => {
    it('opens closed, showing no panel at all', () => {
        // The whole reason this primitive takes a nullable value: the panels it
        // holds fetch on mount, and a card should not pay for four records
        // nobody asked to see.
        render(<Harness />);

        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.queryByText('panel one')).not.toBeInTheDocument();
        expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    });

    it('shows only the selected panel', () => {
        render(<Harness />);

        fireEvent.click(screen.getByRole('tab', { name: /^Two/ }));

        expect(screen.getByText('panel two')).toBeInTheDocument();
        expect(screen.queryByText('panel one')).not.toBeInTheDocument();
        expect(screen.queryByText('panel three')).not.toBeInTheDocument();
    });

    it('marks the selected tab for a screen reader', () => {
        render(<Harness initial="one" />);

        expect(screen.getByRole('tab', { name: /^One/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: /^Two/ })).toHaveAttribute('aria-selected', 'false');
    });

    it('closes the open tab when it is clicked again', () => {
        // Without this the strip is a one-way door: the first click commits the
        // card to showing a record for as long as it stays open.
        render(<Harness initial="one" />);
        expect(screen.getByText('panel one')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: /^One/ }));

        expect(screen.queryByText('panel one')).not.toBeInTheDocument();
    });

    it('ties each panel to the tab that opens it', () => {
        render(<Harness initial="two" />);

        const tab = screen.getByRole('tab', { name: /^Two/ });
        const panel = screen.getByRole('tabpanel');
        expect(tab).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    });

    it('shows a count only where one is given', () => {
        render(<Harness />);

        expect(screen.getByRole('tab', { name: 'One 3' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Two' })).toBeInTheDocument();
        // Zero is a count, not an absence — a record that is empty says so.
        expect(screen.getByRole('tab', { name: 'Three 0' })).toBeInTheDocument();
    });

    it('moves between tabs with the arrow keys', () => {
        render(<Harness initial="one" />);

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
        expect(screen.getByText('panel two')).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
        expect(screen.getByText('panel one')).toBeInTheDocument();
    });

    it('wraps around at both ends', () => {
        render(<Harness initial="three" />);

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
        expect(screen.getByText('panel one')).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
        expect(screen.getByText('panel three')).toBeInTheDocument();
    });

    it('opens at either end from closed, rather than ignoring the key', () => {
        render(<Harness />);

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
        expect(screen.getByText('panel one')).toBeInTheDocument();
    });

    it('keeps a tab stop on the strip when nothing is selected', () => {
        // Otherwise a closed strip cannot be tabbed onto at all, and the arrow
        // keys above are unreachable.
        render(<Harness />);

        expect(screen.getByRole('tab', { name: /^One/ })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: /^Two/ })).toHaveAttribute('tabindex', '-1');
    });

    it('moves the tab stop to whichever tab is open', () => {
        render(<Harness initial="two" />);

        expect(screen.getByRole('tab', { name: /^Two/ })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: /^One/ })).toHaveAttribute('tabindex', '-1');
    });

    // A strip that heads a card with nothing open would otherwise rule a line
    // right on top of the card's own bottom edge.
    it('draws its rule only when asked to', () => {
        const { rerender } = render(
            <Tabs<K> tabs={TABS} value={null} onChange={jest.fn()} idPrefix="r" label="Rule" />,
        );
        expect(screen.getByRole('tablist', { name: 'Rule' }).className).toMatch(/border-b/);

        rerender(
            <Tabs<K> tabs={TABS} value={null} onChange={jest.fn()} idPrefix="r" label="Rule" bordered={false} />,
        );
        expect(screen.getByRole('tablist', { name: 'Rule' }).className).not.toMatch(/border-b/);
    });
});
