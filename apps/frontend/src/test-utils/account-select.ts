import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Drive an `AccountSelect` the way a user does: open it, then click a row.
 *
 * The picker is a listbox rather than a native `<select>`, so `fireEvent.change`
 * on the trigger does nothing — tests must go through the popup.
 */
export function selectAccount(triggerLabel: string, accountName: string | RegExp) {
    fireEvent.click(screen.getByLabelText(triggerLabel));
    const listbox = screen.getByRole('listbox', { name: triggerLabel });
    fireEvent.click(within(listbox).getByText(accountName));
}

/** The label the picker's trigger currently shows — `code — name`, or the placeholder. */
export function selectedAccountLabel(triggerLabel: string): string {
    return screen.getByLabelText(triggerLabel).textContent?.trim() ?? '';
}
