import { z } from "zod";

export const UserRole = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
  ACCOUNTANT: "ACCOUNTANT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const StorePermission = {
  // Product & Catalog
  VIEW_PRODUCT_CATALOG: "VIEW_PRODUCT_CATALOG",
  EDIT_PRODUCTS: "EDIT_PRODUCTS",
  EDIT_PRODUCT_PRICES: "EDIT_PRODUCT_PRICES",
  EDIT_SUPPLIERS: "EDIT_SUPPLIERS",

  // Inventory
  CREATE_INVENTORY_MOVEMENTS: "CREATE_INVENTORY_MOVEMENTS",
  CREATE_GOODS_TRANSFER: "CREATE_GOODS_TRANSFER",
  APPROVE_GOODS_TRANSFER: "APPROVE_GOODS_TRANSFER",
  STOCK_TAKE: "STOCK_TAKE",

  // Transactions
  CREATE_SALE: "CREATE_SALE",
  CREATE_PURCHASE: "CREATE_PURCHASE",
  CREATE_RETURN: "CREATE_RETURN",
  CREATE_SALES_ORDER: "CREATE_SALES_ORDER",
  CREATE_QUOTATION: "CREATE_QUOTATION",

  // Accounting
  VIEW_LEDGER: "VIEW_LEDGER",
  CREATE_VOUCHER: "CREATE_VOUCHER",
  VIEW_FINANCIAL_REPORTS: "VIEW_FINANCIAL_REPORTS",

  // Fund Transfers
  CREATE_FUND_TRANSFER: "CREATE_FUND_TRANSFER",
  APPROVE_FUND_TRANSFER: "APPROVE_FUND_TRANSFER",

  // Multi-Store
  SWITCH_STORES: "SWITCH_STORES",
  VIEW_CONSOLIDATED_REPORTS: "VIEW_CONSOLIDATED_REPORTS",

  // User Management
  MANAGE_USERS: "MANAGE_USERS",
  MANAGE_USER_STORE_ACCESS: "MANAGE_USER_STORE_ACCESS",

  // POS Counters
  MANAGE_COUNTERS: "MANAGE_COUNTERS",
} as const;
export type StorePermission = (typeof StorePermission)[keyof typeof StorePermission];

/** Permissions automatically granted by role when provisioning a user. */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, StorePermission[]> = {
  [UserRole.OWNER]: Object.values(StorePermission),
  [UserRole.MANAGER]: [
    StorePermission.VIEW_PRODUCT_CATALOG,
    StorePermission.EDIT_PRODUCTS,
    StorePermission.EDIT_PRODUCT_PRICES,
    StorePermission.EDIT_SUPPLIERS,
    StorePermission.CREATE_INVENTORY_MOVEMENTS,
    StorePermission.CREATE_GOODS_TRANSFER,
    StorePermission.STOCK_TAKE,
    StorePermission.CREATE_SALE,
    StorePermission.CREATE_PURCHASE,
    StorePermission.CREATE_RETURN,
    StorePermission.CREATE_SALES_ORDER,
    StorePermission.CREATE_QUOTATION,
    StorePermission.VIEW_LEDGER,
    StorePermission.CREATE_VOUCHER,
    StorePermission.VIEW_FINANCIAL_REPORTS,
    StorePermission.CREATE_FUND_TRANSFER,
    StorePermission.SWITCH_STORES,
    StorePermission.MANAGE_COUNTERS,
  ],
  [UserRole.CASHIER]: [
    StorePermission.VIEW_PRODUCT_CATALOG,
    StorePermission.CREATE_SALE,
    StorePermission.CREATE_RETURN,
    StorePermission.SWITCH_STORES,
    StorePermission.VIEW_LEDGER,
  ],
  [UserRole.ACCOUNTANT]: [
    StorePermission.VIEW_PRODUCT_CATALOG,
    StorePermission.VIEW_LEDGER,
    StorePermission.CREATE_VOUCHER,
    StorePermission.VIEW_FINANCIAL_REPORTS,
    StorePermission.SWITCH_STORES,
    StorePermission.VIEW_CONSOLIDATED_REPORTS,
  ],
};

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
}

export interface Tenant {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  TRIALING: 'TRIALING',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SubscriptionPlanCode = {
  FREE: 'FREE',
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
} as const;
export type SubscriptionPlanCode = (typeof SubscriptionPlanCode)[keyof typeof SubscriptionPlanCode];

export interface SubscriptionPlanSummary {
  code: SubscriptionPlanCode;
  name: string;
  description?: string | null;
  monthly_price: number;
  yearly_price?: number | null;
  features_json?: Record<string, unknown>;
}

export interface TenantSubscriptionSummary {
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  is_premium: boolean;
  is_paid_plan: boolean;
  plan: SubscriptionPlanSummary;
}

export interface UserStoreAccess {
  id: string;
  user_id: string;
  store_id: string;
  tenant_id: string;
  /** STORE_ONLY = locked to this store; MULTI_STORE_CAPABLE = can switch */
  access_level: "STORE_ONLY" | "MULTI_STORE_CAPABLE";
  created_at: string;
}

export interface TenantContextSummary {
  id: string;
  name: string;
  role: UserRole;
  /** All stores user has UserStoreAccess for (not all tenant stores). */
  stores: Store[];
  subscription?: TenantSubscriptionSummary | null;
}

export interface Store {
  id: string;
  tenant_id: string;
  name: string;
  address?: string;
  created_at: string;
}

export interface ApiError {
  error: {
    code: string; // A machine-readable error code (e.g., 'validation_error', 'not_found')
    message: string; // A human-readable error message
    details?: Record<string, any>; // Optional structured data, like Zod validation issues
    timestamp: string; // ISO 8601 timestamp of the error
    requestId: string; // A unique ID for tracing the request
    statusCode?: number; // Optional status code for internal use
  };
}

export const AccountType = {
  ASSET: "asset",
  LIABILITY: "liability",
  EQUITY: "equity",
  REVENUE: "revenue",
  EXPENSE: "expense",
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountCategory = {
  CASH: "cash",
  BANK: "bank",
  GENERAL: "general",
} as const;
export type AccountCategory = (typeof AccountCategory)[keyof typeof AccountCategory];

export const VoucherType = {
  CASH_PAYMENT: "cash_payment",
  CASH_RECEIVE: "cash_receive",
  BANK_PAYMENT: "bank_payment",
  BANK_RECEIVE: "bank_receive",
  FUND_TRANSFER: "fund_transfer",
  JOURNAL: "journal",
} as const;
export type VoucherType = (typeof VoucherType)[keyof typeof VoucherType];

export const PostingRuleEventType = {
  SALE: 'sale',
  SALE_RETURN: 'sale_return',
  PURCHASE: 'purchase',
  PURCHASE_RETURN: 'purchase_return',
  INVENTORY_ADJUSTMENT: 'inventory_adjustment',
  FUND_MOVEMENT: 'fund_movement',
} as const;
export type PostingRuleEventType = (typeof PostingRuleEventType)[keyof typeof PostingRuleEventType];

export const PostingRuleConditionKey = {
  PAYMENT_MODE: 'payment_mode',
  REASON_TYPE: 'reason_type',
  TRANSFER_SCOPE: 'transfer_scope',
  NONE: 'none',
} as const;
export type PostingRuleConditionKey = (typeof PostingRuleConditionKey)[keyof typeof PostingRuleConditionKey];

export const PostingEventStatus = {
  PENDING: 'pending',
  POSTED: 'posted',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;
export type PostingEventStatus = (typeof PostingEventStatus)[keyof typeof PostingEventStatus];

export interface PostingRule {
  id: string;
  eventType: PostingRuleEventType;
  conditionKey: PostingRuleConditionKey;
  conditionValue?: string | null;
  debitAccountId: string;
  creditAccountId: string;
  priority: number;
  isActive: boolean;
  updatedAt: string;
}

export interface PostingException {
  id: string;
  eventType: PostingRuleEventType;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  status: PostingEventStatus;
  attemptCount: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  voucher?: {
    id: string;
    voucher_number: string;
    voucher_type: string;
  } | null;
}

// --- VALIDATION SCHEMAS ---

export const SignupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  tenantName: z.string().min(2, "Organization name must be at least 2 characters"),
  storeName: z.string().min(2, "Store name must be at least 2 characters"),
  planCode: z.nativeEnum(SubscriptionPlanCode).default(SubscriptionPlanCode.FREE),
});

export type SignupInput = z.infer<typeof SignupSchema>;

// --- PRODUCT SCHEMAS ---

export interface Product {
  id: string;
  tenant_id: string;
  group_id?: string | null;
  subgroup_id?: string | null;
  name: string;
  sku?: string | null;
  price: number;
  warranty_enabled?: boolean;
  warranty_duration_days?: number | null;
  reorder_level?: number | null;
  safety_stock?: number | null;
  lead_time_days?: number | null;
  image_url?: string | null;
  group?: ProductGroup | null;
  subgroup?: ProductSubgroup | null;
  stocks?: ProductStock[];
}

export interface ProductGroup {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  _count?: { subgroups?: number; products?: number };
}

export interface ProductSubgroup {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  group?: ProductGroup | null;
  _count?: { products?: number };
}

export interface Warehouse {
  id: string;
  tenant_id: string;
  store_id: string;
  name: string;
  code: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductStock {
  id: string;
  tenant_id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  warehouse?: Warehouse;
}

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  product_id: string;
  warehouse_id: string;
  movement_type: string;
  reference_type?: string | null;
  reference_id?: string | null;
  quantity_delta: number;
  balance_after?: number | null;
  unit_cost?: number | null;
  note?: string | null;
  created_at: string;
  product?: Product;
  warehouse?: Warehouse;
}

export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface Purchase {
  id: string;
  tenant_id: string;
  store_id: string;
  supplier_id?: string | null;
  purchase_number: string;
  subtotal_amount: number;
  tax_amount: number;
  discount_amount: number;
  freight_amount: number;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  items: PurchaseItem[];
  supplier?: Supplier | null;
}

export interface PurchaseReturnItem {
  id: string;
  return_id: string;
  purchase_item_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface PurchaseReturn {
  id: string;
  tenant_id: string;
  store_id: string;
  purchase_id: string;
  supplier_id?: string | null;
  return_number: string;
  reference_number?: string | null;
  total_amount: number;
  notes?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  items: PurchaseReturnItem[];
  supplier?: Supplier | null;
  purchase?: Purchase | null;
}

export const WarrantyClaimStatus = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REPAIRED: 'REPAIRED',
  REPLACED: 'REPLACED',
  COMPLETED: 'COMPLETED',
} as const;
export type WarrantyClaimStatus = (typeof WarrantyClaimStatus)[keyof typeof WarrantyClaimStatus];

export interface WarrantyClaim {
  id: string;
  tenant_id: string;
  store_id: string;
  claim_number: string;
  serial_number: string;
  product_id: string;
  sale_id?: string | null;
  customer_id?: string | null;
  status: WarrantyClaimStatus;
  reason: string;
  description?: string | null;
  resolution_notes?: string | null;
  replacement_serial_number?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  product?: Product | null;
  sale?: { id: string; serial_number: string } | null;
  customer?: { id: string; name: string; phone: string } | null;
  store?: { id: string; name: string } | null;
}

export const EmployeeStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type EmployeeStatus = (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface Designation {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface Employee {
  id: string;
  tenant_id: string;
  employee_code: string;
  name: string;
  phone: string;
  email?: string | null;
  nid?: string | null;
  date_of_joining?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  user_id?: string | null;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
  department?: Department | null;
  designation?: Designation | null;
  user?: { id: string; email: string; name?: string | null } | null;
}

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  HALF_DAY: 'HALF_DAY',
  HOLIDAY: 'HOLIDAY',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const LeaveRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LeaveRequestStatus = (typeof LeaveRequestStatus)[keyof typeof LeaveRequestStatus];

export interface LeaveType {
  id: string;
  tenant_id: string;
  name: string;
  days_per_year: number;
  created_at: string;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  total_days: number;
  used_days: number;
  leave_type?: LeaveType;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  status: AttendanceStatus;
  notes?: string | null;
  employee?: { id: string; name: string; employee_code: string } | null;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string | null;
  status: LeaveRequestStatus;
  approved_by?: string | null;
  approved_at?: string | null;
  approver_note?: string | null;
  created_at: string;
  employee?: { id: string; name: string; employee_code: string } | null;
  leave_type?: LeaveType | null;
  approver?: { id: string; name?: string | null; email: string } | null;
}

export const ProductSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters"),
  sku: z.string().min(3, "SKU must be at least 3 characters").optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Price cannot be negative"),
  warrantyEnabled: z.coerce.boolean().default(false),
  warrantyDurationDays: z.coerce.number().int().min(0).optional(),
  initialStock: z.coerce.number().min(0, "Initial stock cannot be negative").default(0),
  groupId: z.string().uuid().optional(),
  subgroupId: z.string().uuid().optional(),
  reorderLevel: z.coerce.number().min(0).optional(),
  safetyStock: z.coerce.number().min(0).optional(),
  leadTimeDays: z.coerce.number().min(0).optional(),
});

export type ProductInput = z.infer<typeof ProductSchema>;
