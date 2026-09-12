/**
 * Who holds a task, in the one key space the module uses everywhere:
 * `user:<id>` for somebody with a login, `employee:<id>` for a team member
 * without one. Two columns on the row, one value in every picker.
 */

export interface TaskHolder {
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name?: string | null } | null;
}

/**
 * Who a newly created task lands on.
 *
 * A task created with nobody holding it falls outside the Tasks page's default
 * "assigned to me" filter, which is why creating one used to force the detail
 * panel open — the row simply was not there and the page looked broken. Giving
 * it a holder fixes the cause rather than the symptom: it lands inside the slice
 * the user is already looking at.
 *
 * The filter wins over the signed-in user, so composing a run of tasks while
 * filtered to Rafi puts them on Rafi. "Unassigned" is a deliberate choice to
 * look at nobody's work, and is left alone.
 */
export function defaultAssigneeFor(
    assignee: string,
    userId: string | null,
): { assigneeId?: string; assigneeEmployeeId?: string } {
    if (assignee.startsWith('user:')) return { assigneeId: assignee.slice('user:'.length) };
    if (assignee.startsWith('employee:')) {
        return { assigneeEmployeeId: assignee.slice('employee:'.length) };
    }
    if (assignee === 'unassigned') return {};
    return userId ? { assigneeId: userId } : {};
}

/**
 * Splits a key into the two columns a PATCH has to send.
 *
 * Both are always sent, and `''` rather than `undefined` clears one: PATCH
 * reads `undefined` as "leave alone", so sending only the column that gained a
 * value would leave a task holding a user *and* an employee.
 */
export function assigneeColumns(key: string): {
    assigneeId: string;
    assigneeEmployeeId: string;
} {
    return {
        assigneeId: key.startsWith('user:') ? key.slice('user:'.length) : '',
        assigneeEmployeeId: key.startsWith('employee:') ? key.slice('employee:'.length) : '',
    };
}

/** The key a task's current holder sits under, or '' for nobody. */
export function assigneeKeyOf(task: TaskHolder): string {
    if (task.assignee) return `user:${task.assignee.id}`;
    if (task.assigneeEmployee) return `employee:${task.assigneeEmployee.id}`;
    return '';
}

/** A task goes to a user or to an employee with no login; show whichever holds it. */
export function assigneeLabelOf(task: TaskHolder, fallback = '—'): string {
    if (task.assignee) return task.assignee.name || task.assignee.email;
    if (task.assigneeEmployee) return task.assigneeEmployee.name ?? fallback;
    return fallback;
}
