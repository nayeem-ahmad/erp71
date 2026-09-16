/**
 * What a picker should call one warehouse.
 *
 * Warehouse names are unique within a **branch**, not within a tenant — two
 * branches each calling a location "Godown" is normal, and `@@unique([tenant_id,
 * store_id, name])` allows it on purpose. `GET /inventory/warehouses` is
 * tenant-wide, though, so any list built straight from it can hold two
 * warehouses that read identically, and a `<select>` showing the name alone
 * leaves "which one holds the stock?" with no answer.
 *
 * The branch is therefore appended only where it settles something. A shop with
 * one branch, or with distinct names across its branches — the overwhelmingly
 * common case — sees exactly what it saw before, and nobody reads "Cold Store
 * (Dhaka Branch)" on a screen where "Cold Store" was never ambiguous.
 */

export interface LabelableWarehouse {
    id: string;
    name: string;
    store?: { name?: string | null } | null;
}

/** The branch name, when the row carries one worth printing. */
function branchOf(warehouse: LabelableWarehouse): string {
    return (warehouse.store?.name ?? '').trim();
}

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * @param warehouse the row being rendered
 * @param all every row in the same list — the only thing that can make a name
 *        ambiguous. Pass the list the user is actually choosing from, not the
 *        tenant's whole set, or a name filtered out of view would still qualify
 *        its siblings.
 */
export function warehouseLabel(warehouse: LabelableWarehouse, all: LabelableWarehouse[]): string {
    const name = warehouse.name?.trim() || '';
    const shared = all.some((other) => other.id !== warehouse.id && normalize(other.name ?? '') === normalize(name));
    if (!shared) return name;

    // A row whose branch is unknown (an older payload, or a list built without
    // the relation) keeps the bare name: a blank parenthesis would be worse than
    // an ambiguous one.
    const branch = branchOf(warehouse);
    return branch ? `${name} (${branch})` : name;
}
