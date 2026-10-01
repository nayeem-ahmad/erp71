import { fireEvent, screen } from '@testing-library/react';

/**
 * Drive an `IdSearchSelect` / `PartySearchSelect` the way a user does: focus
 * the box, then click a row. `fireEvent.change` on the input only types a
 * query — it does not pick an id.
 */
export function pickSearchOption(label: string | RegExp, optionText: string | RegExp) {
    fireEvent.mouseDown(document.body);
    const input = screen.getByLabelText(label);
    fireEvent.focus(input);
    const matches = screen.getAllByText(optionText);
    const row = matches.find((el) => el.closest('.cursor-pointer')) ?? matches[matches.length - 1];
    fireEvent.click(row);
}
