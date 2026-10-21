/**
 * Per-member layout of the payment methods on each money screen.
 *
 * A cashier who takes bKash all day wants it first and the cheque method out of
 * the way; a back-office user recording supplier payments wants the opposite.
 * The layout is held per member (`TenantUser.payment_method_prefs`), per branch
 * — a method offered at several branches is not necessarily the one a person
 * reaches for at each — and per screen.
 */

/** The four screens that take a tender and show the method list. */
export type PaymentLayoutContext = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';

export const PAYMENT_LAYOUT_CONTEXTS: readonly PaymentLayoutContext[] = [
  'sale',
  'purchase',
  'sale_return',
  'purchase_return',
];

/**
 * One screen's layout at one branch. `order` lists method ids in the member's
 * chosen order; `hidden` lists those they have tucked away. An available method
 * in neither list (added by an admin since the member last saved) is appended,
 * visible, in the default order. Ids that are no longer available are skipped.
 */
export interface PaymentLayoutEntry {
  order: string[];
  hidden: string[];
}

/** The whole preference blob: storeId -> screen -> layout. */
export type PaymentMethodPrefs = Record<
  string /* storeId */,
  Partial<Record<PaymentLayoutContext, PaymentLayoutEntry>>
>;

/**
 * What the layout endpoint returns for one branch and screen: `visible` is the
 * strip, in order; `available` is every method the branch offers, for the
 * customise dialog. `customised` is false when the member has saved nothing and
 * `visible` is the tenant default.
 */
export interface PaymentLayoutResponse<M> {
  customised: boolean;
  visible: M[];
  available: M[];
}
