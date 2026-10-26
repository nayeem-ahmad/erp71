/** Narrowest and widest a double-click on a resize grip will make a column. */
export const AUTOFIT_MIN_WIDTH = 48;
export const AUTOFIT_MAX_WIDTH = 640;

/**
 * The width a column's cells take when nothing squeezes them — what a
 * double-click on its resize grip fits it to.
 *
 * The rendered table is `table-layout: fixed`, so its cells only ever report
 * the width they were given. Copies of them are laid out instead, in a hidden
 * table that sizes itself to its content and carries the real one's classes
 * and text size, so the copies are measured in the same type. Removed before
 * the browser paints. `0` when nothing could be measured (no layout, as in a
 * test).
 */
export function naturalColumnWidth(table: HTMLTableElement, columnId: string): number {
    const cells = table.querySelectorAll<HTMLElement>(`[data-column-id="${CSS.escape(columnId)}"]`);
    if (cells.length === 0 || !table.parentElement) return 0;

    const probe = document.createElement('table');
    probe.className = table.className;
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;table-layout:auto;width:max-content';
    const fontSize = table.style.getPropertyValue('--dt-font-size');
    if (fontSize) probe.style.setProperty('--dt-font-size', fontSize);
    const body = probe.createTBody();
    cells.forEach((cell) => {
        const copy = cell.cloneNode(true) as HTMLElement;
        copy.style.width = '';
        copy.style.minWidth = '';
        copy.style.maxWidth = '';
        // The grip sits on the edge of a header cell; it is no part of its width.
        copy.querySelectorAll('[data-resize-handle]').forEach((handle) => handle.remove());
        body.insertRow().appendChild(copy);
    });

    table.parentElement.appendChild(probe);
    const width = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    if (!width) return 0;
    return Math.min(AUTOFIT_MAX_WIDTH, Math.max(AUTOFIT_MIN_WIDTH, width));
}
