import { z } from "zod";

export const UserRole = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
  ACCOUNTANT: "ACCOUNTANT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Payment method types — the single source of truth for both the backend DTO
 * validator and the settings form. These exact strings are what get stored in
 * `PaymentMethod.type` and mapped to a canonical accounting string on the
 * sales-entry UI, so the API and the form must never drift apart.
 */
export const PaymentMethodType = {
  CASH: "Cash",
  MOBILE_WALLET: "Mobile Wallet",
  CARD: "Card",
  BANK: "Bank",
} as const;
export type PaymentMethodType =
  (typeof PaymentMethodType)[keyof typeof PaymentMethodType];
export const PAYMENT_METHOD_TYPE_VALUES = Object.values(
  PaymentMethodType,
) as PaymentMethodType[];

export const StorePermission = {
  // Product & Catalog
  VIEW_PRODUCT_CATALOG: "VIEW_PRODUCT_CATALOG",
  EDIT_PRODUCTS: "EDIT_PRODUCTS",
  EDIT_PRODUCT_PRICES: "EDIT_PRODUCT_PRICES",
  EDIT_SUPPLIERS: "EDIT_SUPPLIERS",
  EDIT_BRANDS: "EDIT_BRANDS",

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
  MANAGE_STORES: "MANAGE_STORES",

  // POS Counters
  MANAGE_COUNTERS: "MANAGE_COUNTERS",

  // CRM
  VIEW_CRM_INTERACTIONS: "VIEW_CRM_INTERACTIONS",
  CREATE_CRM_INTERACTIONS: "CREATE_CRM_INTERACTIONS",
  MANAGE_CRM_TASKS: "MANAGE_CRM_TASKS",
  VIEW_CUSTOMER_CREDIT: "VIEW_CUSTOMER_CREDIT",
  MANAGE_CUSTOMER_CREDIT: "MANAGE_CUSTOMER_CREDIT",
  VIEW_LEADS: "VIEW_LEADS",
  MANAGE_LEADS: "MANAGE_LEADS",
  VIEW_LEAD_CONVERSATIONS: "VIEW_LEAD_CONVERSATIONS",
  CREATE_LEAD_CONVERSATIONS: "CREATE_LEAD_CONVERSATIONS",
  MANAGE_CRM_SETTINGS: "MANAGE_CRM_SETTINGS",

  // Loans
  VIEW_LOANS: "VIEW_LOANS",
  MANAGE_LOANS: "MANAGE_LOANS",
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
    StorePermission.EDIT_BRANDS,
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
    StorePermission.VIEW_CRM_INTERACTIONS,
    StorePermission.CREATE_CRM_INTERACTIONS,
    StorePermission.MANAGE_CRM_TASKS,
    StorePermission.VIEW_CUSTOMER_CREDIT,
    StorePermission.MANAGE_CUSTOMER_CREDIT,
    StorePermission.VIEW_LEADS,
    StorePermission.MANAGE_LEADS,
    StorePermission.VIEW_LEAD_CONVERSATIONS,
    StorePermission.CREATE_LEAD_CONVERSATIONS,
    StorePermission.MANAGE_CRM_SETTINGS,
    StorePermission.VIEW_LOANS,
    StorePermission.MANAGE_LOANS,
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
    StorePermission.VIEW_LOANS,
    StorePermission.MANAGE_LOANS,
  ],
};

/**
 * Maps a system TenantRole's display name to its coarse UserRole enum. The
 * granular `tenant_role_id` is the source of truth for permissions, but the
 * coarse `TenantUser.role` enum still drives role display and the OWNER/MANAGER
 * authorization gates (`request.userRole`), so the two must be kept in lockstep.
 * Custom (non-system) roles have no coarse equivalent and fall back to CASHIER
 * (least privilege). Keyed by the same names seeded in `seedDefaultTenantRoles`.
 */
export const SYSTEM_TENANT_ROLE_TO_USER_ROLE: Record<string, UserRole> = {
  Manager: UserRole.MANAGER,
  Cashier: UserRole.CASHIER,
  Accountant: UserRole.ACCOUNTANT,
};

/** Resolve the coarse UserRole enum for an assigned TenantRole name (default CASHIER). */
export function resolveBaseUserRole(tenantRoleName: string | null | undefined): UserRole {
  return SYSTEM_TENANT_ROLE_TO_USER_ROLE[(tenantRoleName ?? "").trim()] ?? UserRole.CASHIER;
}

/** Human-readable labels for each store permission (used by the team management UI). */
export const STORE_PERMISSION_LABELS: Record<StorePermission, string> = {
  [StorePermission.VIEW_PRODUCT_CATALOG]: "View product catalog",
  [StorePermission.EDIT_PRODUCTS]: "Add & edit products",
  [StorePermission.EDIT_PRODUCT_PRICES]: "Edit product prices",
  [StorePermission.EDIT_SUPPLIERS]: "Manage suppliers",
  [StorePermission.EDIT_BRANDS]: "Manage brands",
  [StorePermission.CREATE_INVENTORY_MOVEMENTS]: "Adjust inventory",
  [StorePermission.CREATE_GOODS_TRANSFER]: "Create goods transfers",
  [StorePermission.APPROVE_GOODS_TRANSFER]: "Approve goods transfers",
  [StorePermission.STOCK_TAKE]: "Perform stock takes",
  [StorePermission.CREATE_SALE]: "Create sales",
  [StorePermission.CREATE_PURCHASE]: "Create purchases",
  [StorePermission.CREATE_RETURN]: "Process returns",
  [StorePermission.CREATE_SALES_ORDER]: "Create sales orders",
  [StorePermission.CREATE_QUOTATION]: "Create quotations",
  [StorePermission.VIEW_LEDGER]: "View ledger",
  [StorePermission.CREATE_VOUCHER]: "Create vouchers",
  [StorePermission.VIEW_FINANCIAL_REPORTS]: "View financial reports",
  [StorePermission.CREATE_FUND_TRANSFER]: "Create fund transfers",
  [StorePermission.APPROVE_FUND_TRANSFER]: "Approve fund transfers",
  [StorePermission.SWITCH_STORES]: "Switch between branches",
  [StorePermission.VIEW_CONSOLIDATED_REPORTS]: "View consolidated reports",
  [StorePermission.MANAGE_USERS]: "Manage team members",
  [StorePermission.MANAGE_USER_STORE_ACCESS]: "Manage branch access",
  [StorePermission.MANAGE_STORES]: "Rename stores",
  [StorePermission.MANAGE_COUNTERS]: "Manage POS counters",
  [StorePermission.VIEW_CRM_INTERACTIONS]: "View CRM interactions",
  [StorePermission.CREATE_CRM_INTERACTIONS]: "Log CRM interactions",
  [StorePermission.MANAGE_CRM_TASKS]: "Manage CRM tasks",
  [StorePermission.VIEW_CUSTOMER_CREDIT]: "View customer credit",
  [StorePermission.MANAGE_CUSTOMER_CREDIT]: "Manage customer credit",
  [StorePermission.VIEW_LEADS]: "View leads",
  [StorePermission.MANAGE_LEADS]: "Manage leads",
  [StorePermission.VIEW_LEAD_CONVERSATIONS]: "View lead conversations",
  [StorePermission.CREATE_LEAD_CONVERSATIONS]: "Log lead conversations",
  [StorePermission.MANAGE_CRM_SETTINGS]: "Manage CRM custom fields & settings",
  [StorePermission.VIEW_LOANS]: "View loans",
  [StorePermission.MANAGE_LOANS]: "Manage loans",
};

/** Store permissions grouped by feature area — drives the per-branch permission matrix UI. */
export const STORE_PERMISSION_GROUPS: { label: string; permissions: StorePermission[] }[] = [
  {
    label: "Products & Catalog",
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.EDIT_PRODUCTS,
      StorePermission.EDIT_PRODUCT_PRICES,
      StorePermission.EDIT_SUPPLIERS,
      StorePermission.EDIT_BRANDS,
    ],
  },
  {
    label: "Inventory",
    permissions: [
      StorePermission.CREATE_INVENTORY_MOVEMENTS,
      StorePermission.CREATE_GOODS_TRANSFER,
      StorePermission.APPROVE_GOODS_TRANSFER,
      StorePermission.STOCK_TAKE,
    ],
  },
  {
    label: "Sales & Purchases",
    permissions: [
      StorePermission.CREATE_SALE,
      StorePermission.CREATE_PURCHASE,
      StorePermission.CREATE_RETURN,
      StorePermission.CREATE_SALES_ORDER,
      StorePermission.CREATE_QUOTATION,
    ],
  },
  {
    label: "Accounting & Funds",
    permissions: [
      StorePermission.VIEW_LEDGER,
      StorePermission.CREATE_VOUCHER,
      StorePermission.VIEW_FINANCIAL_REPORTS,
      StorePermission.CREATE_FUND_TRANSFER,
      StorePermission.APPROVE_FUND_TRANSFER,
      StorePermission.VIEW_LOANS,
      StorePermission.MANAGE_LOANS,
    ],
  },
  {
    label: "Multi-Branch",
    permissions: [
      StorePermission.SWITCH_STORES,
      StorePermission.VIEW_CONSOLIDATED_REPORTS,
    ],
  },
  {
    label: "CRM",
    permissions: [
      StorePermission.VIEW_CRM_INTERACTIONS,
      StorePermission.CREATE_CRM_INTERACTIONS,
      StorePermission.MANAGE_CRM_TASKS,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      StorePermission.MANAGE_CUSTOMER_CREDIT,
      StorePermission.VIEW_LEADS,
      StorePermission.MANAGE_LEADS,
      StorePermission.VIEW_LEAD_CONVERSATIONS,
      StorePermission.CREATE_LEAD_CONVERSATIONS,
      StorePermission.MANAGE_CRM_SETTINGS,
    ],
  },
  {
    label: "Administration",
    permissions: [
      StorePermission.MANAGE_USERS,
      StorePermission.MANAGE_USER_STORE_ACCESS,
      StorePermission.MANAGE_STORES,
      StorePermission.MANAGE_COUNTERS,
    ],
  },
];

export interface TenantRoleSummary {
  id: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  permissions: StorePermission[];
  member_count?: number;
}

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
  ACCOUNTING: 'ACCOUNTING',
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
} as const;
export type SubscriptionPlanCode = (typeof SubscriptionPlanCode)[keyof typeof SubscriptionPlanCode];

export const BusinessType = {
  SURGICAL_MEDICAL: 'SURGICAL_MEDICAL',
  PHARMACY: 'PHARMACY',
  GROCERY: 'GROCERY',
  COMPUTER_HARDWARE: 'COMPUTER_HARDWARE',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const BUSINESS_TYPE_VALUES = Object.values(BusinessType) as BusinessType[];

/** Business types that have a starter product catalog under packages/database/prisma/templates/. */
export const BUSINESS_TYPES_WITH_TEMPLATE: BusinessType[] = [BusinessType.SURGICAL_MEDICAL];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  SURGICAL_MEDICAL: 'Surgical / Medical',
  PHARMACY: 'Pharmacy',
  GROCERY: 'Grocery',
  COMPUTER_HARDWARE: 'Computer Hardware',
};

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
  tenant_role?: { id: string; name: string } | null;
  permissions?: StorePermission[];
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
  LOAN_DISBURSEMENT: 'loan_disbursement',
  LOAN_REPAYMENT: 'loan_repayment',
} as const;
export type PostingRuleEventType = (typeof PostingRuleEventType)[keyof typeof PostingRuleEventType];

export const PostingRuleConditionKey = {
  PAYMENT_MODE: 'payment_mode',
  REASON_TYPE: 'reason_type',
  TRANSFER_SCOPE: 'transfer_scope',
  LOAN_DIRECTION: 'loan_direction',
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

export interface Brand {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  brand_id?: string | null;
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
  brand?: Brand | null;
  group?: ProductGroup | null;
  subgroup?: ProductSubgroup | null;
  stocks?: ProductStock[];
  description?: string | null;
  images_gallery?: string[];
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

// ---------------------------------------------------------------------------
// Platform feature toggles (platform-admin)
// ---------------------------------------------------------------------------

export interface PlatformFeatures {
  feedback: boolean;
  support: boolean;
  help: boolean;
  voice: boolean;
  manufacturing: boolean;
  aiChat: boolean;
}

export const DEFAULT_PLATFORM_FEATURES: PlatformFeatures = {
  feedback: false,
  support: false,
  help: false,
  voice: false,
  manufacturing: false,
  aiChat: false,
};

export type PlatformFeatureKey = keyof PlatformFeatures;

export const PLATFORM_FEATURE_KEYS: PlatformFeatureKey[] = [
  'feedback',
  'support',
  'help',
  'voice',
  'manufacturing',
  'aiChat',
];

/**
 * Per-tenant overrides of the platform-wide feature switches.
 * A missing key means "inherit the platform default"; an explicit boolean wins
 * over the platform setting, so a feature can be piloted on (or pulled) for a
 * single tenant without touching everyone else.
 */
export type TenantFeatureOverrides = Partial<Record<PlatformFeatureKey, boolean>>;

/** Narrows an untrusted JSON blob (Prisma `Json` column, request body) to known keys. */
export function parseTenantFeatureOverrides(raw: unknown): TenantFeatureOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const overrides: TenantFeatureOverrides = {};
  for (const key of PLATFORM_FEATURE_KEYS) {
    if (typeof source[key] === 'boolean') overrides[key] = source[key] as boolean;
  }
  return overrides;
}

/** Platform defaults with the tenant's explicit overrides applied on top. */
export function resolveTenantFeatures(
  platform: PlatformFeatures,
  overrides: unknown,
): PlatformFeatures {
  return { ...platform, ...parseTenantFeatureOverrides(overrides) };
}

const PLATFORM_FEATURE_SETTING_KEYS: Record<keyof PlatformFeatures, string> = {
  feedback: 'feedback_enabled',
  support: 'support_enabled',
  help: 'help_enabled',
  voice: 'voice_enabled',
  manufacturing: 'manufacturing_enabled',
  aiChat: 'ai_chat_enabled',
};

/** Parses general-group platform settings into feature booleans (`'true'` only). */
export function parsePlatformFeatures(
  settings: Record<string, string | null | undefined>,
): PlatformFeatures {
  return {
    feedback: settings[PLATFORM_FEATURE_SETTING_KEYS.feedback] === 'true',
    support: settings[PLATFORM_FEATURE_SETTING_KEYS.support] === 'true',
    help: settings[PLATFORM_FEATURE_SETTING_KEYS.help] === 'true',
    voice: settings[PLATFORM_FEATURE_SETTING_KEYS.voice] === 'true',
    manufacturing: settings[PLATFORM_FEATURE_SETTING_KEYS.manufacturing] === 'true',
    aiChat: settings[PLATFORM_FEATURE_SETTING_KEYS.aiChat] === 'true',
  };
}

// ---------------------------------------------------------------------------
// System health monitoring (platform-admin)
// ---------------------------------------------------------------------------

/**
 * State of a single monitored dependency or of the system overall.
 * - `ok`       — reachable and within thresholds
 * - `degraded` — reachable but unhealthy (slow, near a limit, or a non-critical
 *                dependency is down)
 * - `down`     — unreachable / failing
 * - `disabled` — not configured for this environment (never affects rollup)
 * - `unknown`  — could not be determined
 */
export type DependencyState = "ok" | "degraded" | "down" | "disabled" | "unknown";

export interface CheckResult {
  /** Stable identifier, e.g. "database", "redis", "bkash". */
  name: string;
  /** Human-friendly label for the dashboard. */
  label: string;
  state: DependencyState;
  /** Probe round-trip time in milliseconds, when measured. */
  latency_ms?: number;
  /** Short explanation, especially for non-ok states. */
  message?: string;
  /** Whether this check can pull the overall status to `down` (vs. capped at `degraded`). */
  critical: boolean;
  /** Additional structured data (pool stats, db size, etc.). */
  details?: Record<string, unknown>;
}

// ── AI Credits ───────────────────────────────────────────────────────────────

/** Monthly AI credit allowance per subscription plan. 1 credit = 1,000 tokens. */
export const AI_CREDITS_PER_PLAN: Record<SubscriptionPlanCode, number> = {
  FREE: 0,
  BASIC: 100,
  ACCOUNTING: 100,
  STANDARD: 500,
  PREMIUM: 2000,
};

/** Tokens per credit (used for conversion in both directions). */
export const AI_TOKENS_PER_CREDIT = 1000;

export interface AiUsageSummary {
  plan: SubscriptionPlanCode;
  credits_limit: number;
  credits_used: number;
  credits_remaining: number;
  period_start: string;
  period_end: string;
  logs: AiUsageLogEntry[];
}

export interface AiUsageLogEntry {
  id: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  credits_used: number;
  cost_usd: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// AI data chatbot
// ---------------------------------------------------------------------------

/**
 * One tool the assistant ran while answering. Deliberately carries no result
 * payload — enough to show the user (and an auditor) what was looked at, not a
 * second copy of the business data itself.
 */
export interface AiChatToolCall {
  name: string;
  args: Record<string, unknown>;
  rowCount?: number;
  ms?: number;
  error?: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: AiChatToolCall[];
  credits_used?: number;
  created_at: string;
}

export interface AiChatResponse {
  conversation_id: string;
  message: AiChatMessage;
  /** Credits consumed by this turn across every model round-trip it took. */
  credits_used: number;
  /** True when the agent hit its round-trip cap before finishing. */
  truncated: boolean;
}

export interface AiChatConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface AiChatConversationDetail extends AiChatConversationSummary {
  messages: AiChatMessage[];
}

/** Tool names the assistant may expose, in the order they are offered to the model. */
export const AI_CHAT_TOOL_NAMES = [
  "sales_summary",
  "top_products",
  "low_stock",
  "stock_on_hand",
  "customer_lookup",
  "receivables_aging",
  "expense_summary",
  "purchase_summary",
] as const;

export type AiChatToolName = (typeof AI_CHAT_TOOL_NAMES)[number];

export interface SystemHealthReport {
  /** Worst-of rollup across all checks (optional/disabled deps excluded). */
  status: DependencyState;
  generated_at: string;
  uptime_seconds: number;
  /** Total wall-clock time spent running all checks. */
  duration_ms: number;
  checks: CheckResult[];
}

export * from './navigation';
export * from './subscription-plans';
export * from './phone';
