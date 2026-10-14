/**
 * Record history — before/after snapshots of business records, kept for
 * platform admins. The backend writes them (`RecordHistoryInterceptor`), the
 * admin console reads them (`/admin/record-history`); both sides take the list
 * of what can be tracked from here so a new type cannot reach one and not the
 * other.
 */

export const RECORD_HISTORY_ENTITY_TYPES = [
  'CUSTOMER',
  'SUPPLIER',
  'PRODUCT',
  'SALE',
  'SALES_RETURN',
  'SALES_EXCHANGE',
  'PURCHASE',
  'PURCHASE_RETURN',
  'CUSTOMER_PAYMENT',
  'SUPPLIER_PAYMENT',
] as const;

export type RecordHistoryEntityType = (typeof RECORD_HISTORY_ENTITY_TYPES)[number];

export const RECORD_HISTORY_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'CANCEL',
  'FINALIZE',
  'MERGE',
  'ALLOCATE',
  'UNALLOCATE',
] as const;

export type RecordHistoryAction = (typeof RECORD_HISTORY_ACTIONS)[number];

/** The `record_history` platform-settings group, and the key that switches each type. */
export const RECORD_HISTORY_SETTINGS_GROUP = 'record_history';

export const RECORD_HISTORY_SETTING_KEYS: Record<RecordHistoryEntityType, string> = {
  CUSTOMER: 'customer',
  SUPPLIER: 'supplier',
  PRODUCT: 'product',
  SALE: 'sale',
  SALES_RETURN: 'sales_return',
  SALES_EXCHANGE: 'sales_exchange',
  PURCHASE: 'purchase',
  PURCHASE_RETURN: 'purchase_return',
  CUSTOMER_PAYMENT: 'customer_payment',
  SUPPLIER_PAYMENT: 'supplier_payment',
};

/** Days a history row is kept. `0` keeps it for as long as the tenant exists. */
export const RECORD_HISTORY_RETENTION_KEY = 'retention_days';
export const RECORD_HISTORY_DEFAULT_RETENTION_DAYS = 365;

export function isRecordHistoryEntityType(value: unknown): value is RecordHistoryEntityType {
  return typeof value === 'string' && (RECORD_HISTORY_ENTITY_TYPES as readonly string[]).includes(value);
}

/** One field that differs between two snapshots. `path` reads like `items[Rice 5kg].quantity`. */
export interface RecordHistoryChange {
  path: string;
  from: unknown;
  to: unknown;
}
