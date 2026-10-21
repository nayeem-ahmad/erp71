import type { PaymentLayoutContext, PaymentLayoutEntry, PaymentMethodPrefs } from '@erp71/shared-types';

/**
 * Resolves the strip for one screen. `available` must arrive in the tenant's
 * default order (`sort_order`), which is also the order any method the member
 * has not placed yet is appended in.
 *
 * No saved entry: the tenant default, the methods flagged `show_on_entry`.
 * Saved entry: everything available that is not hidden, in the saved order;
 * ids the entry names that are no longer available simply never match.
 */
export function resolvePaymentLayout<M extends { id: string; show_on_entry: boolean; sort_order: number }>(
  available: M[],
  saved: PaymentLayoutEntry | undefined,
): { customised: boolean; visible: M[] } {
  if (!saved) {
    return { customised: false, visible: available.filter((m) => m.show_on_entry) };
  }
  const hidden = new Set(saved.hidden);
  const byId = new Map(available.map((m) => [m.id, m]));
  const visible: M[] = [];
  const placed = new Set<string>();
  for (const id of saved.order) {
    const method = byId.get(id);
    if (!method || placed.has(id)) continue;
    placed.add(id);
    if (!hidden.has(id)) visible.push(method);
  }
  for (const method of available) {
    if (!placed.has(method.id) && !hidden.has(method.id)) visible.push(method);
  }
  return { customised: true, visible };
}

function asPrefs(prefs: unknown): PaymentMethodPrefs {
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? (prefs as PaymentMethodPrefs) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The saved layout for one branch and screen, or undefined when there is none. */
export function readLayoutEntry(
  prefs: unknown,
  storeId: string,
  context: PaymentLayoutContext,
): PaymentLayoutEntry | undefined {
  const branch = asPrefs(prefs)[storeId];
  const entry = branch && typeof branch === 'object' ? branch[context] : undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  return { order: stringList(entry.order), hidden: stringList(entry.hidden) };
}

/**
 * Returns a copy of `prefs` with one branch/screen entry set, or removed when
 * `entry` is null (and the branch key too once it holds nothing). Every other
 * branch and screen is carried over untouched.
 */
export function setLayoutEntry(
  prefs: unknown,
  storeId: string,
  context: PaymentLayoutContext,
  entry: PaymentLayoutEntry | null,
): PaymentMethodPrefs {
  const next: PaymentMethodPrefs = { ...asPrefs(prefs) };
  const rawBranch = next[storeId];
  const branch = { ...(rawBranch && typeof rawBranch === 'object' ? rawBranch : {}) };
  if (entry) {
    branch[context] = { order: [...entry.order], hidden: [...entry.hidden] };
  } else {
    delete branch[context];
  }
  if (Object.keys(branch).length) next[storeId] = branch;
  else delete next[storeId];
  return next;
}
