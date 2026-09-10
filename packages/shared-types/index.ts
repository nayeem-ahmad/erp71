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
  CREATE_PRODUCT_DEMAND: "CREATE_PRODUCT_DEMAND",
  APPROVE_PRODUCT_DEMAND: "APPROVE_PRODUCT_DEMAND",

  // Transactions
  CREATE_SALE: "CREATE_SALE",
  CREATE_PURCHASE: "CREATE_PURCHASE",
  CREATE_RETURN: "CREATE_RETURN",
  CREATE_SALES_ORDER: "CREATE_SALES_ORDER",
  CREATE_QUOTATION: "CREATE_QUOTATION",

  // Accounting
  VIEW_LEDGER: "VIEW_LEDGER",
  CREATE_VOUCHER: "CREATE_VOUCHER",
  APPROVE_VOUCHER: "APPROVE_VOUCHER",
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
  APPROVE_CRM_ACTIVITY: "APPROVE_CRM_ACTIVITY",
  VIEW_CUSTOMER_CREDIT: "VIEW_CUSTOMER_CREDIT",
  MANAGE_CUSTOMER_CREDIT: "MANAGE_CUSTOMER_CREDIT",
  VIEW_LEADS: "VIEW_LEADS",
  MANAGE_LEADS: "MANAGE_LEADS",
  VIEW_LEAD_CONVERSATIONS: "VIEW_LEAD_CONVERSATIONS",
  CREATE_LEAD_CONVERSATIONS: "CREATE_LEAD_CONVERSATIONS",
  MANAGE_CRM_SETTINGS: "MANAGE_CRM_SETTINGS",

  // HR
  VIEW_HR: "VIEW_HR",
  VIEW_PAYROLL: "VIEW_PAYROLL",
  MANAGE_HR: "MANAGE_HR",

  // Loans
  VIEW_LOANS: "VIEW_LOANS",
  MANAGE_LOANS: "MANAGE_LOANS",

  // Investors & profit sharing
  VIEW_INVESTORS: "VIEW_INVESTORS",
  MANAGE_INVESTORS: "MANAGE_INVESTORS",

  // Projects
  VIEW_PROJECTS: "VIEW_PROJECTS",
  VIEW_ALL_PROJECTS: "VIEW_ALL_PROJECTS",
  MANAGE_PROJECTS: "MANAGE_PROJECTS",
  MANAGE_PROJECT_TASKS: "MANAGE_PROJECT_TASKS",
  LOG_PROJECT_TIME: "LOG_PROJECT_TIME",
  MANAGE_SPRINTS: "MANAGE_SPRINTS",
  MANAGE_PROJECT_SETTINGS: "MANAGE_PROJECT_SETTINGS",

  // Imports (LC)
  VIEW_IMPORTS: "VIEW_IMPORTS",
  MANAGE_IMPORTS: "MANAGE_IMPORTS",
  // Separate from MANAGE_IMPORTS on purpose: adding an import cost changes the
  // landed cost of the goods and therefore the COGS on every subsequent sale of
  // them. That is a finance action, not a warehouse one.
  MANAGE_IMPORT_COSTS: "MANAGE_IMPORT_COSTS",

  // Short Links
  MANAGE_SHORT_LINKS: "MANAGE_SHORT_LINKS",

  // Storefront blog
  VIEW_BLOG: "VIEW_BLOG",
  MANAGE_BLOG: "MANAGE_BLOG",
  PUBLISH_BLOG: "PUBLISH_BLOG",

  // Storefront pages & menu
  // One permission, not the blog's view/write/publish trio: a page is a short
  // standing document an owner writes once, so there is no draft-then-approve
  // workflow to gate. Publishing one is still a public act, which is why it is
  // not folded into the ungated storefront settings endpoint.
  MANAGE_STOREFRONT_PAGES: "MANAGE_STOREFRONT_PAGES",

  // Team chat
  // Gates access to the feature only. It deliberately has no "manage" sibling:
  // staff conversations are private to their participants, so there is no
  // permission that grants reading someone else's thread — not even for OWNER,
  // who bypasses every check in this list. See apps/backend/src/chat.
  USE_TEAM_CHAT: "USE_TEAM_CHAT",
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
    StorePermission.CREATE_PRODUCT_DEMAND,
    StorePermission.APPROVE_PRODUCT_DEMAND,
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
    StorePermission.APPROVE_CRM_ACTIVITY,
    StorePermission.VIEW_CUSTOMER_CREDIT,
    StorePermission.MANAGE_CUSTOMER_CREDIT,
    StorePermission.VIEW_LEADS,
    StorePermission.MANAGE_LEADS,
    StorePermission.VIEW_LEAD_CONVERSATIONS,
    StorePermission.CREATE_LEAD_CONVERSATIONS,
    StorePermission.MANAGE_CRM_SETTINGS,
    StorePermission.VIEW_HR,
    StorePermission.MANAGE_HR,
    StorePermission.VIEW_LOANS,
    StorePermission.MANAGE_LOANS,
    StorePermission.VIEW_INVESTORS,
    StorePermission.VIEW_IMPORTS,
    StorePermission.MANAGE_IMPORTS,
    StorePermission.VIEW_PROJECTS,
    StorePermission.MANAGE_PROJECTS,
    StorePermission.MANAGE_PROJECT_TASKS,
    StorePermission.LOG_PROJECT_TIME,
    StorePermission.MANAGE_SPRINTS,
    StorePermission.MANAGE_PROJECT_SETTINGS,
    StorePermission.MANAGE_SHORT_LINKS,
    StorePermission.VIEW_BLOG,
    StorePermission.MANAGE_BLOG,
    StorePermission.PUBLISH_BLOG,
    StorePermission.MANAGE_STOREFRONT_PAGES,
    StorePermission.USE_TEAM_CHAT,
  ],
  [UserRole.CASHIER]: [
    StorePermission.VIEW_PRODUCT_CATALOG,
    // The person at the counter is the one who notices a shelf is empty, so
    // raising a demand is a cashier capability. Approving it is not.
    StorePermission.CREATE_PRODUCT_DEMAND,
    StorePermission.CREATE_SALE,
    StorePermission.CREATE_RETURN,
    StorePermission.SWITCH_STORES,
    StorePermission.VIEW_LEDGER,
    StorePermission.USE_TEAM_CHAT,
  ],
  [UserRole.ACCOUNTANT]: [
    StorePermission.VIEW_PRODUCT_CATALOG,
    StorePermission.VIEW_LEDGER,
    StorePermission.CREATE_VOUCHER,
    StorePermission.APPROVE_VOUCHER,
    StorePermission.VIEW_FINANCIAL_REPORTS,
    StorePermission.SWITCH_STORES,
    StorePermission.VIEW_CONSOLIDATED_REPORTS,
    StorePermission.VIEW_LOANS,
    StorePermission.MANAGE_LOANS,
    StorePermission.VIEW_INVESTORS,
    StorePermission.MANAGE_INVESTORS,
    StorePermission.USE_TEAM_CHAT,
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

/**
 * Resolve the coarse UserRole enum for an assigned TenantRole name (default
 * CASHIER). The three legacy system roles are matched first, then the seeded
 * `TENANT_ROLE_TEMPLATES` by the name each is created with; anything else — a
 * renamed role, a role the owner wrote themselves — is CASHIER, which is least
 * privilege for the workspace-wide gates the enum still guards.
 */
export function resolveBaseUserRole(tenantRoleName: string | null | undefined): UserRole {
  const name = (tenantRoleName ?? "").trim();
  return (
    SYSTEM_TENANT_ROLE_TO_USER_ROLE[name] ??
    TEMPLATE_ROLE_NAME_TO_COARSE_ROLES[name]?.[0] ??
    UserRole.CASHIER
  );
}

/**
 * Every coarse `UserRole` gate the given roles open, taken together.
 *
 * `TenantUser.role` can only hold one value, so a member who is both a Tenant
 * Admin and an Accounting User would otherwise lose one of the two gates the
 * moment the other won. `TenantRoleGuard` checks this set rather than the stored
 * enum alone, which keeps the coarse gates consistent with the rule that a
 * member's access is the union of their roles.
 */
export function resolveCoarseRolesForNames(
  tenantRoleNames: (string | null | undefined)[],
): UserRole[] {
  const union = new Set<UserRole>();
  for (const raw of tenantRoleNames) {
    const name = (raw ?? "").trim();
    const legacy = SYSTEM_TENANT_ROLE_TO_USER_ROLE[name];
    if (legacy) {
      union.add(legacy);
      continue;
    }
    for (const role of TEMPLATE_ROLE_NAME_TO_COARSE_ROLES[name] ?? [UserRole.CASHIER]) {
      union.add(role);
    }
  }
  return [...union];
}

/* ------------------------- Tenant role templates -------------------------- */

/**
 * Where a seeded role sits in the two-tier ladder every module gets: a MANAGER
 * who approves and configures, and a USER who does the day-to-day work of the
 * same module. ADMIN is the workspace-wide exception — it is not a module role.
 */
export const TenantRoleLevel = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  USER: "USER",
} as const;
export type TenantRoleLevel =
  (typeof TenantRoleLevel)[keyof typeof TenantRoleLevel];

/**
 * One seeded role. Every tenant gets a copy of each template as a real
 * `TenantRole` row at signup, so an owner can edit or delete their copy without
 * touching anybody else's.
 */
export interface TenantRoleTemplate {
  /**
   * Stable identity, written to `TenantRole.template_key`. It is what makes the
   * seeding idempotent and what lets a later sync find the tenant's copy after
   * the owner has renamed it — so it must never be reused for a different role.
   */
  key: string;
  /** Display name the role is first created with. Owners may rename it. */
  name: string;
  /** Module this role belongs to. Groups the role picker in Team → Members. */
  module: string;
  level: TenantRoleLevel;
  description: string;
  /**
   * The coarse `UserRole` gates this role opens, strongest intent first — the
   * first is what `TenantUser.role` becomes while it is the member's primary
   * role, and `TenantRoleGuard` accepts any of them.
   *
   * Two entries exist because one enum column cannot say "administrator AND
   * accountant": MANAGER is what `/invitations` checks before letting someone
   * add staff, and ACCOUNTANT is what the accounting controllers check, and
   * Tenant Admin is meant to be both.
   *
   * Every module role stays at CASHIER on purpose. The enum gates workspace-wide
   * actions, and a Sales Manager must not inherit those just for being a manager
   * of one module — their real reach is the permission set below, materialized
   * per branch. The exceptions are the administration roles (MANAGER, so they
   * can staff the workspace) and the accounting roles (ACCOUNTANT, without which
   * the accounting module refuses them outright).
   */
  coarseRoles: UserRole[];
  permissions: StorePermission[];
}

/** Everyone can be reached in team chat — see `USE_TEAM_CHAT`'s note above. */
const CHAT: StorePermission[] = [StorePermission.USE_TEAM_CHAT];

/**
 * The roles every new tenant is seeded with, on top of the three legacy system
 * roles (Manager, Cashier, Accountant) that `SYSTEM_TENANT_ROLE_TO_USER_ROLE`
 * still maps.
 *
 * Two per module — manager and user — so a workspace can staff a module without
 * anybody hand-building a permission matrix, plus the administration roles at
 * the top. A member may hold several of these at once; their effective access is
 * the union of every role they hold (see `syncMemberPermissionsFromRole`), which
 * is why each template stays narrow rather than defensively bundling extras.
 *
 * VIEW_ALL_PROJECTS is deliberately in none of them, including Project Manager:
 * it overrides per-project privacy, so it stays a grant an owner makes on
 * purpose. Same reasoning as `sync-role-permissions.ts`.
 */
export const TENANT_ROLE_TEMPLATES: TenantRoleTemplate[] = [
  /* ----------------------------- Administration ---------------------------- */
  {
    key: "tenant_admin",
    name: "Tenant Admin",
    module: "Administration",
    level: TenantRoleLevel.ADMIN,
    description:
      "Full access to every module and to team, branch and role settings. The workspace owner's deputy.",
    coarseRoles: [UserRole.MANAGER, UserRole.ACCOUNTANT],
    permissions: Object.values(StorePermission),
  },
  {
    key: "administration_manager",
    name: "User Manager",
    module: "Administration",
    level: TenantRoleLevel.MANAGER,
    description:
      "Adds and removes staff, branches and POS counters without access to business data.",
    coarseRoles: [UserRole.MANAGER],
    permissions: [
      StorePermission.MANAGE_USERS,
      StorePermission.MANAGE_USER_STORE_ACCESS,
      StorePermission.MANAGE_STORES,
      StorePermission.MANAGE_COUNTERS,
      StorePermission.SWITCH_STORES,
      ...CHAT,
    ],
  },

  /* --------------------------------- Sales -------------------------------- */
  {
    key: "sales_manager",
    name: "Sales Manager",
    module: "Sales",
    level: TenantRoleLevel.MANAGER,
    description:
      "Runs the sales floor: prices, returns, customer credit and cross-branch sales reporting.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.EDIT_PRODUCT_PRICES,
      StorePermission.CREATE_SALE,
      StorePermission.CREATE_RETURN,
      StorePermission.CREATE_SALES_ORDER,
      StorePermission.CREATE_QUOTATION,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      StorePermission.MANAGE_CUSTOMER_CREDIT,
      StorePermission.MANAGE_COUNTERS,
      StorePermission.SWITCH_STORES,
      StorePermission.VIEW_CONSOLIDATED_REPORTS,
      ...CHAT,
    ],
  },
  {
    key: "sales_user",
    name: "Sales User",
    module: "Sales",
    level: TenantRoleLevel.USER,
    description:
      "Sells at the counter: invoices, orders and quotations, with no pricing or credit control.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.CREATE_SALE,
      StorePermission.CREATE_RETURN,
      StorePermission.CREATE_SALES_ORDER,
      StorePermission.CREATE_QUOTATION,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      ...CHAT,
    ],
  },

  /* ------------------------------- Purchase -------------------------------- */
  {
    key: "purchase_manager",
    name: "Purchase Manager",
    module: "Purchase",
    level: TenantRoleLevel.MANAGER,
    description:
      "Owns supplier relationships, purchase orders and sign-off on what the branches ask for.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.EDIT_SUPPLIERS,
      StorePermission.CREATE_PURCHASE,
      StorePermission.CREATE_RETURN,
      StorePermission.CREATE_PRODUCT_DEMAND,
      StorePermission.APPROVE_PRODUCT_DEMAND,
      StorePermission.SWITCH_STORES,
      StorePermission.VIEW_CONSOLIDATED_REPORTS,
      ...CHAT,
    ],
  },
  {
    key: "purchase_user",
    name: "Purchase User",
    module: "Purchase",
    level: TenantRoleLevel.USER,
    description:
      "Raises purchases and product demands; cannot approve them or edit suppliers.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.CREATE_PURCHASE,
      StorePermission.CREATE_PRODUCT_DEMAND,
      ...CHAT,
    ],
  },

  /* ------------------------------- Inventory ------------------------------- */
  {
    key: "inventory_manager",
    name: "Inventory Manager",
    module: "Inventory",
    level: TenantRoleLevel.MANAGER,
    description:
      "Controls stock: adjustments, branch transfers and their approval, stock takes and demands.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.CREATE_INVENTORY_MOVEMENTS,
      StorePermission.CREATE_GOODS_TRANSFER,
      StorePermission.APPROVE_GOODS_TRANSFER,
      StorePermission.STOCK_TAKE,
      StorePermission.CREATE_PRODUCT_DEMAND,
      StorePermission.APPROVE_PRODUCT_DEMAND,
      StorePermission.SWITCH_STORES,
      StorePermission.VIEW_CONSOLIDATED_REPORTS,
      ...CHAT,
    ],
  },
  {
    key: "inventory_user",
    name: "Inventory User",
    module: "Inventory",
    level: TenantRoleLevel.USER,
    description:
      "Moves and counts stock in one branch; transfers still need a manager's approval.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.CREATE_INVENTORY_MOVEMENTS,
      StorePermission.CREATE_GOODS_TRANSFER,
      StorePermission.STOCK_TAKE,
      StorePermission.CREATE_PRODUCT_DEMAND,
      ...CHAT,
    ],
  },

  /* -------------------------------- Catalog -------------------------------- */
  {
    key: "catalog_manager",
    name: "Catalog Manager",
    module: "Catalog",
    level: TenantRoleLevel.MANAGER,
    description:
      "Owns the product master: products, prices, brands and supplier records.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.EDIT_PRODUCTS,
      StorePermission.EDIT_PRODUCT_PRICES,
      StorePermission.EDIT_BRANDS,
      StorePermission.EDIT_SUPPLIERS,
      ...CHAT,
    ],
  },
  {
    key: "catalog_user",
    name: "Catalog User",
    module: "Catalog",
    level: TenantRoleLevel.USER,
    description:
      "Adds and edits products; prices, brands and suppliers stay with the manager.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PRODUCT_CATALOG,
      StorePermission.EDIT_PRODUCTS,
      ...CHAT,
    ],
  },

  /* ------------------------------- Accounting ------------------------------ */
  {
    key: "accounting_manager",
    name: "Accounting Manager",
    module: "Accounting",
    level: TenantRoleLevel.MANAGER,
    description:
      "Approves vouchers and fund transfers and reads every financial report across branches.",
    coarseRoles: [UserRole.ACCOUNTANT],
    permissions: [
      StorePermission.VIEW_LEDGER,
      StorePermission.CREATE_VOUCHER,
      StorePermission.APPROVE_VOUCHER,
      StorePermission.VIEW_FINANCIAL_REPORTS,
      StorePermission.CREATE_FUND_TRANSFER,
      StorePermission.APPROVE_FUND_TRANSFER,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      StorePermission.MANAGE_CUSTOMER_CREDIT,
      StorePermission.SWITCH_STORES,
      StorePermission.VIEW_CONSOLIDATED_REPORTS,
      ...CHAT,
    ],
  },
  {
    key: "accounting_user",
    name: "Accounting User",
    module: "Accounting",
    level: TenantRoleLevel.USER,
    description:
      "Books vouchers and transfers for someone else to approve; reads the ledger.",
    coarseRoles: [UserRole.ACCOUNTANT],
    permissions: [
      StorePermission.VIEW_LEDGER,
      StorePermission.CREATE_VOUCHER,
      StorePermission.VIEW_FINANCIAL_REPORTS,
      StorePermission.CREATE_FUND_TRANSFER,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      ...CHAT,
    ],
  },

  /* ---------------------------------- CRM ---------------------------------- */
  {
    key: "crm_manager",
    name: "CRM Manager",
    module: "CRM",
    level: TenantRoleLevel.MANAGER,
    description:
      "Runs the pipeline: lead ownership, activity sign-off and CRM configuration.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_CRM_INTERACTIONS,
      StorePermission.CREATE_CRM_INTERACTIONS,
      StorePermission.MANAGE_CRM_TASKS,
      StorePermission.APPROVE_CRM_ACTIVITY,
      StorePermission.VIEW_LEADS,
      StorePermission.MANAGE_LEADS,
      StorePermission.VIEW_LEAD_CONVERSATIONS,
      StorePermission.CREATE_LEAD_CONVERSATIONS,
      StorePermission.MANAGE_CRM_SETTINGS,
      StorePermission.VIEW_CUSTOMER_CREDIT,
      ...CHAT,
    ],
  },
  {
    key: "crm_user",
    name: "CRM User",
    module: "CRM",
    level: TenantRoleLevel.USER,
    description:
      "Works leads and logs conversations; approvals and CRM settings stay with the manager.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_CRM_INTERACTIONS,
      StorePermission.CREATE_CRM_INTERACTIONS,
      StorePermission.MANAGE_CRM_TASKS,
      StorePermission.VIEW_LEADS,
      StorePermission.VIEW_LEAD_CONVERSATIONS,
      StorePermission.CREATE_LEAD_CONVERSATIONS,
      ...CHAT,
    ],
  },

  /* ---------------------------------- HR ----------------------------------- */
  {
    key: "hr_manager",
    name: "HR Manager",
    module: "HR",
    level: TenantRoleLevel.MANAGER,
    description:
      "Owns employee records, attendance, leave and payroll figures.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_HR,
      StorePermission.MANAGE_HR,
      StorePermission.VIEW_PAYROLL,
      ...CHAT,
    ],
  },
  {
    key: "hr_user",
    name: "HR User",
    module: "HR",
    level: TenantRoleLevel.USER,
    description:
      "Reads employee records and attendance. Salary figures need a deliberate grant.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [StorePermission.VIEW_HR, ...CHAT],
  },

  /* -------------------------------- Projects ------------------------------- */
  {
    key: "project_manager",
    name: "Project Manager",
    module: "Projects",
    level: TenantRoleLevel.MANAGER,
    description:
      "Plans and runs projects: tasks, sprints, time and project settings.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PROJECTS,
      StorePermission.MANAGE_PROJECTS,
      StorePermission.MANAGE_PROJECT_TASKS,
      StorePermission.MANAGE_SPRINTS,
      StorePermission.MANAGE_PROJECT_SETTINGS,
      StorePermission.LOG_PROJECT_TIME,
      ...CHAT,
    ],
  },
  {
    key: "project_user",
    name: "Project User",
    module: "Projects",
    level: TenantRoleLevel.USER,
    description:
      "Works the projects they are a member of: their tasks and their time log.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_PROJECTS,
      StorePermission.MANAGE_PROJECT_TASKS,
      StorePermission.LOG_PROJECT_TIME,
      ...CHAT,
    ],
  },

  /* -------------------------------- Imports -------------------------------- */
  {
    key: "imports_manager",
    name: "Import Manager",
    module: "Imports",
    level: TenantRoleLevel.MANAGER,
    description:
      "Runs LC shipments end to end, including the landed costs that move COGS.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_IMPORTS,
      StorePermission.MANAGE_IMPORTS,
      StorePermission.MANAGE_IMPORT_COSTS,
      ...CHAT,
    ],
  },
  {
    key: "imports_user",
    name: "Import User",
    module: "Imports",
    level: TenantRoleLevel.USER,
    description:
      "Tracks shipments and documents. Costing stays with the manager because it moves COGS.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_IMPORTS,
      StorePermission.MANAGE_IMPORTS,
      ...CHAT,
    ],
  },

  /* --------------------------------- Loans --------------------------------- */
  {
    key: "loans_manager",
    name: "Loan Manager",
    module: "Loans",
    level: TenantRoleLevel.MANAGER,
    description: "Records loans, disbursements and repayments.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_LOANS,
      StorePermission.MANAGE_LOANS,
      ...CHAT,
    ],
  },
  {
    key: "loans_user",
    name: "Loan User",
    module: "Loans",
    level: TenantRoleLevel.USER,
    description: "Reads the loan book without changing it.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [StorePermission.VIEW_LOANS, ...CHAT],
  },

  /* ------------------------------- Investors ------------------------------- */
  {
    key: "investors_manager",
    name: "Investor Manager",
    module: "Investors",
    level: TenantRoleLevel.MANAGER,
    description: "Maintains investors, their contributions and profit sharing.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_INVESTORS,
      StorePermission.MANAGE_INVESTORS,
      ...CHAT,
    ],
  },
  {
    key: "investors_user",
    name: "Investor User",
    module: "Investors",
    level: TenantRoleLevel.USER,
    description: "Reads investor balances and payouts without changing them.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [StorePermission.VIEW_INVESTORS, ...CHAT],
  },

  /* ------------------------------- Marketing ------------------------------- */
  {
    key: "marketing_manager",
    name: "Marketing Manager",
    module: "Marketing",
    level: TenantRoleLevel.MANAGER,
    description:
      "Owns the storefront blog end to end, including publishing, plus the shop's standing pages, menu and the short-link tools.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_BLOG,
      StorePermission.MANAGE_BLOG,
      StorePermission.PUBLISH_BLOG,
      StorePermission.MANAGE_STOREFRONT_PAGES,
      StorePermission.MANAGE_SHORT_LINKS,
      ...CHAT,
    ],
  },
  {
    key: "marketing_user",
    name: "Marketing User",
    module: "Marketing",
    level: TenantRoleLevel.USER,
    description:
      "Writes and edits blog drafts. Putting one on the public shop page needs the manager.",
    coarseRoles: [UserRole.CASHIER],
    permissions: [
      StorePermission.VIEW_BLOG,
      StorePermission.MANAGE_BLOG,
      StorePermission.MANAGE_SHORT_LINKS,
      ...CHAT,
    ],
  },
];

/** Template lookup by `TenantRole.template_key`. */
export const TENANT_ROLE_TEMPLATE_BY_KEY: Record<string, TenantRoleTemplate> =
  Object.fromEntries(TENANT_ROLE_TEMPLATES.map((tpl) => [tpl.key, tpl]));

/**
 * Module order for the role picker — declaration order of the templates, so the
 * UI never has to keep its own list in step with this one.
 */
export const TENANT_ROLE_MODULES: string[] = TENANT_ROLE_TEMPLATES.reduce<
  string[]
>((acc, tpl) => (acc.includes(tpl.module) ? acc : [...acc, tpl.module]), []);

/**
 * Base-role fallback for the seeded templates, keyed by the name each is created
 * with. Deliberately separate from `SYSTEM_TENANT_ROLE_TO_USER_ROLE`: that map is
 * also the list `sync-role-permissions.ts` reconciles against
 * `ROLE_DEFAULT_PERMISSIONS`, and a template role's permissions come from its
 * template, never from a coarse role's defaults.
 */
const TEMPLATE_ROLE_NAME_TO_COARSE_ROLES: Record<string, UserRole[]> =
  Object.fromEntries(TENANT_ROLE_TEMPLATES.map((tpl) => [tpl.name, tpl.coarseRoles]));

/** Strongest first — used to collapse several held roles into one coarse enum. */
const BASE_USER_ROLE_RANK: Record<UserRole, number> = {
  [UserRole.OWNER]: 3,
  [UserRole.MANAGER]: 2,
  [UserRole.ACCOUNTANT]: 1,
  [UserRole.CASHIER]: 0,
};

/**
 * Collapse every TenantRole a member holds into the single coarse
 * `TenantUser.role` enum, taking the strongest. The enum is not the permission
 * model — that is the union of the roles' `StorePermission`s, materialized per
 * branch — it only drives role display and the few workspace-wide OWNER/MANAGER
 * gates, so "strongest wins" is the only answer consistent with a member's
 * access being the union of their roles.
 */
export function resolveStrongestBaseUserRole(
  tenantRoleNames: (string | null | undefined)[],
): UserRole {
  return tenantRoleNames.reduce<UserRole>((strongest, name) => {
    const candidate = resolveBaseUserRole(name);
    return BASE_USER_ROLE_RANK[candidate] > BASE_USER_ROLE_RANK[strongest]
      ? candidate
      : strongest;
  }, UserRole.CASHIER);
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
  [StorePermission.CREATE_PRODUCT_DEMAND]: "Submit product demands",
  [StorePermission.APPROVE_PRODUCT_DEMAND]: "Approve & fulfil product demands",
  [StorePermission.CREATE_SALE]: "Create sales",
  [StorePermission.CREATE_PURCHASE]: "Create purchases",
  [StorePermission.CREATE_RETURN]: "Process returns",
  [StorePermission.CREATE_SALES_ORDER]: "Create sales orders",
  [StorePermission.CREATE_QUOTATION]: "Create quotations",
  [StorePermission.VIEW_LEDGER]: "View ledger",
  [StorePermission.CREATE_VOUCHER]: "Create vouchers",
  [StorePermission.APPROVE_VOUCHER]: "Approve & reject vouchers",
  [StorePermission.VIEW_FINANCIAL_REPORTS]: "View financial reports",
  [StorePermission.CREATE_FUND_TRANSFER]: "Create fund transfers",
  [StorePermission.APPROVE_FUND_TRANSFER]: "Approve fund transfers",
  [StorePermission.SWITCH_STORES]: "Switch between branches",
  [StorePermission.VIEW_CONSOLIDATED_REPORTS]: "View consolidated reports",
  [StorePermission.MANAGE_USERS]: "Manage team members",
  [StorePermission.MANAGE_USER_STORE_ACCESS]: "Manage branch access",
  [StorePermission.MANAGE_STORES]: "Add and rename branches",
  [StorePermission.MANAGE_COUNTERS]: "Manage POS counters",
  [StorePermission.VIEW_CRM_INTERACTIONS]: "View CRM interactions",
  [StorePermission.CREATE_CRM_INTERACTIONS]: "Log CRM interactions",
  [StorePermission.MANAGE_CRM_TASKS]: "Manage CRM tasks",
  [StorePermission.APPROVE_CRM_ACTIVITY]: "Approve planned CRM activities",
  [StorePermission.VIEW_CUSTOMER_CREDIT]: "View customer credit",
  [StorePermission.MANAGE_CUSTOMER_CREDIT]: "Manage customer credit",
  [StorePermission.VIEW_LEADS]: "View leads",
  [StorePermission.MANAGE_LEADS]: "Manage leads",
  [StorePermission.VIEW_LEAD_CONVERSATIONS]: "View lead conversations",
  [StorePermission.CREATE_LEAD_CONVERSATIONS]: "Log lead conversations",
  [StorePermission.MANAGE_CRM_SETTINGS]: "Manage CRM custom fields & settings",
  [StorePermission.VIEW_HR]: "View employees & attendance",
  [StorePermission.VIEW_PAYROLL]: "View salary & payroll figures",
  [StorePermission.MANAGE_HR]: "Create & edit employees, departments & designations",
  [StorePermission.VIEW_LOANS]: "View loans",
  [StorePermission.MANAGE_LOANS]: "Manage loans",
  [StorePermission.VIEW_INVESTORS]: "View investors & profit shares",
  [StorePermission.MANAGE_INVESTORS]: "Manage investors, capital & profit runs",
  [StorePermission.VIEW_PROJECTS]: "View projects",
  [StorePermission.VIEW_ALL_PROJECTS]: "View private projects without being a member",
  [StorePermission.MANAGE_PROJECTS]: "Create & edit projects",
  [StorePermission.MANAGE_PROJECT_TASKS]: "Manage project tasks",
  [StorePermission.LOG_PROJECT_TIME]: "Log time on tasks",
  [StorePermission.MANAGE_SPRINTS]: "Plan & run sprints",
  [StorePermission.MANAGE_PROJECT_SETTINGS]: "Manage project types & board columns",
  [StorePermission.VIEW_IMPORTS]: "View import shipments",
  [StorePermission.MANAGE_IMPORTS]: "Create & edit import shipments",
  [StorePermission.MANAGE_IMPORT_COSTS]: "Record import costs & receive shipments",
  [StorePermission.MANAGE_SHORT_LINKS]: "Manage short links",
  [StorePermission.VIEW_BLOG]: "View storefront blog posts",
  [StorePermission.MANAGE_BLOG]: "Write & edit storefront blog posts",
  [StorePermission.PUBLISH_BLOG]: "Publish storefront blog posts",
  [StorePermission.MANAGE_STOREFRONT_PAGES]:
    "Create & edit storefront pages and menu links",
  [StorePermission.USE_TEAM_CHAT]: "Use team chat",
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
      StorePermission.CREATE_PRODUCT_DEMAND,
      StorePermission.APPROVE_PRODUCT_DEMAND,
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
      StorePermission.APPROVE_VOUCHER,
      StorePermission.VIEW_FINANCIAL_REPORTS,
      StorePermission.CREATE_FUND_TRANSFER,
      StorePermission.APPROVE_FUND_TRANSFER,
      StorePermission.VIEW_LOANS,
      StorePermission.MANAGE_LOANS,
      StorePermission.VIEW_INVESTORS,
      StorePermission.MANAGE_INVESTORS,
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
      StorePermission.APPROVE_CRM_ACTIVITY,
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
    label: "Imports (LC)",
    permissions: [
      StorePermission.VIEW_IMPORTS,
      StorePermission.MANAGE_IMPORTS,
      StorePermission.MANAGE_IMPORT_COSTS,
    ],
  },
  {
    label: "HR & Payroll",
    permissions: [
      StorePermission.VIEW_HR,
      StorePermission.VIEW_PAYROLL,
    ],
  },
  {
    label: "Projects",
    permissions: [
      StorePermission.VIEW_PROJECTS,
      StorePermission.VIEW_ALL_PROJECTS,
      StorePermission.MANAGE_PROJECTS,
      StorePermission.MANAGE_PROJECT_TASKS,
      StorePermission.LOG_PROJECT_TIME,
      StorePermission.MANAGE_SPRINTS,
      StorePermission.MANAGE_PROJECT_SETTINGS,
    ],
  },
  {
    label: "Storefront Blog",
    permissions: [
      StorePermission.VIEW_BLOG,
      StorePermission.MANAGE_BLOG,
      StorePermission.PUBLISH_BLOG,
    ],
  },
  {
    label: "Storefront Pages",
    permissions: [StorePermission.MANAGE_STOREFRONT_PAGES],
  },
  {
    label: "Team Chat",
    permissions: [StorePermission.USE_TEAM_CHAT],
  },
  {
    label: "Administration",
    permissions: [
      StorePermission.MANAGE_USERS,
      StorePermission.MANAGE_USER_STORE_ACCESS,
      StorePermission.MANAGE_STORES,
      StorePermission.MANAGE_COUNTERS,
      StorePermission.MANAGE_SHORT_LINKS,
    ],
  },
];

export interface TenantRoleSummary {
  id: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  /** Set when the role was seeded from `TENANT_ROLE_TEMPLATES`; null if the owner wrote it. */
  template_key?: string | null;
  /** Module the role belongs to, for grouping the picker. Null for owner-authored roles. */
  module?: string | null;
  level?: TenantRoleLevel | null;
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

/**
 * Maker-checker state of a voucher. Defaults to APPROVED everywhere so a tenant
 * that never turns approval on behaves exactly as it did before the feature
 * existed — PENDING only ever appears when the tenant asked for it in
 * accounting settings.
 */
export const VoucherApprovalStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type VoucherApprovalStatus =
  (typeof VoucherApprovalStatus)[keyof typeof VoucherApprovalStatus];

export const PostingRuleEventType = {
  SALE: 'sale',
  SALE_RETURN: 'sale_return',
  PURCHASE: 'purchase',
  PURCHASE_RETURN: 'purchase_return',
  INVENTORY_ADJUSTMENT: 'inventory_adjustment',
  FUND_MOVEMENT: 'fund_movement',
  LOAN_DISBURSEMENT: 'loan_disbursement',
  LOAN_REPAYMENT: 'loan_repayment',
  INVESTOR_CONTRIBUTION: 'investor_contribution',
  INVESTOR_WITHDRAWAL: 'investor_withdrawal',
  INVESTOR_PROFIT_ACCRUAL: 'investor_profit_accrual',
  INVESTOR_PROFIT_PAYOUT: 'investor_profit_payout',
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
  /** Lets a tenant admin run the external-ERP import from Data Management. */
  externalImport: boolean;
  /** Project management: projects, tasks, time logging, kanban and sprints. */
  projects: boolean;
  /**
   * The same project module for the platform's own team, inside the admin
   * console, backed by the internal platform workspace. Independent of
   * `projects`, which decides whether *shop* users see the module.
   */
  platformProjects: boolean;
}

export const DEFAULT_PLATFORM_FEATURES: PlatformFeatures = {
  feedback: false,
  support: false,
  help: false,
  voice: false,
  manufacturing: false,
  aiChat: false,
  externalImport: false,
  projects: false,
  platformProjects: false,
};

export type PlatformFeatureKey = keyof PlatformFeatures;

export const PLATFORM_FEATURE_KEYS: PlatformFeatureKey[] = [
  'feedback',
  'support',
  'help',
  'voice',
  'manufacturing',
  'aiChat',
  'externalImport',
  'projects',
  'platformProjects',
];

/**
 * The switches a single tenant may override.
 *
 * Platform-scoped switches govern the admin console rather than a shop, so an
 * "override for this tenant" would be meaningless for them: `platformProjects`
 * decides whether the platform team's own workspace exists, which no customer
 * workspace has an opinion about.
 */
export const TENANT_OVERRIDABLE_FEATURE_KEYS: PlatformFeatureKey[] = PLATFORM_FEATURE_KEYS.filter(
  (key) => key !== 'platformProjects',
);

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
  for (const key of TENANT_OVERRIDABLE_FEATURE_KEYS) {
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
  externalImport: 'external_import_enabled',
  projects: 'projects_enabled',
  platformProjects: 'platform_projects_enabled',
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
    externalImport: settings[PLATFORM_FEATURE_SETTING_KEYS.externalImport] === 'true',
    projects: settings[PLATFORM_FEATURE_SETTING_KEYS.projects] === 'true',
    platformProjects: settings[PLATFORM_FEATURE_SETTING_KEYS.platformProjects] === 'true',
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
  /**
   * Pages a web tool actually read. An internal lookup links to its report page,
   * which the UI resolves from the tool name; a web claim has nowhere to link
   * except the source itself, so those URLs travel with the trace.
   */
  urls?: string[];
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
export * from './lead-identity';
export * from './campaign-rows';
export * from './careers';
export * from './locales';
export * from './terms';
