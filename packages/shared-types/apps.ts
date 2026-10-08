import type { PlatformFeatureKey, PlatformFeatures } from './index';
import { hasPlanEntitlement } from './subscription-plans';

// ---------------------------------------------------------------------------
// Apps — the top-level modules of the tenant sidebar, as the rail shows them
// ---------------------------------------------------------------------------

/**
 * Business apps are the parts of a shop's work an owner may hide; utility apps
 * (chat, help, settings) are always there when they are on at all.
 */
export type AppKind = 'business' | 'utility';

/**
 * - `available` — granted, and this member clears its module-level gate.
 * - `hidden` — available, but the owner hid it from the workspace.
 * - `locked` — the platform offers it and the plan does not grant it: an upsell.
 * - `unavailable` — switched off, outside an accounting-only plan, or closed to
 *   this member.
 */
export type AppState = 'available' | 'hidden' | 'locked' | 'unavailable';

export interface AppDefinition {
  /** The module's id in `NAV_REGISTRY`. */
  id: string;
  kind: AppKind;
  /** Plan entitlement that grants it; absent means every plan has it. */
  entitlement?: string;
  /** Also needs a paid plan — accounting's rule since before this registry. */
  requiresPaidPlan?: boolean;
  /** Platform switch that must be on. */
  platformFeature?: PlatformFeatureKey;
  /** On when any of these switches is (Support answers to support or feedback). */
  platformFeatureAny?: readonly PlatformFeatureKey[];
  /** Still shown on an accounting-only plan. */
  inAccountingOnly?: boolean;
  /** Sold as part of another app, so never offered as a locked tile of its own. */
  soldWith?: string;
  /**
   * The module-level permission gate, for the apps whose gate lived in the
   * shell rather than in `NAV_PERMISSIONS`. Owners bypass it. Projects is kept
   * out of `NAV_PERMISSIONS` on purpose (a test pins that), so its gate is here.
   */
  permissionsAny?: readonly string[];
  /** Rail entries sharing one icon. */
  railGroup?: string;
  /** The platform console's module; never part of a shop's shell. */
  platformAdminOnly?: boolean;
}

export const APP_REGISTRY: Record<string, AppDefinition> = {
  sales: { id: 'sales', kind: 'business' },
  storefront: { id: 'storefront', kind: 'business' },
  purchase: { id: 'purchase', kind: 'business' },
  imports: { id: 'imports', kind: 'business' },
  accounting: {
    id: 'accounting',
    kind: 'business',
    entitlement: 'premiumAccounting',
    requiresPaidPlan: true,
    inAccountingOnly: true,
    permissionsAny: ['VIEW_LEDGER'],
  },
  // Split out of Accounting, but its pages still live under /accounting/expenses
  // and it has always shared Accounting's gate and price.
  expenses: {
    id: 'expenses',
    kind: 'business',
    entitlement: 'premiumAccounting',
    requiresPaidPlan: true,
    inAccountingOnly: true,
    permissionsAny: ['VIEW_LEDGER'],
    soldWith: 'accounting',
  },
  inventory: { id: 'inventory', kind: 'business' },
  crm: { id: 'crm', kind: 'business' },
  projects: { id: 'projects', kind: 'business', platformFeature: 'projects', permissionsAny: ['VIEW_PROJECTS'] },
  manufacturing: {
    id: 'manufacturing',
    kind: 'business',
    entitlement: 'premiumManufacturing',
    platformFeature: 'manufacturing',
  },
  hr: { id: 'hr', kind: 'business' },
  chat: { id: 'chat', kind: 'utility', entitlement: 'teamChat' },
  help: { id: 'help', kind: 'utility', platformFeature: 'help', inAccountingOnly: true, railGroup: 'help' },
  support: {
    id: 'support',
    kind: 'utility',
    platformFeatureAny: ['support', 'feedback'],
    inAccountingOnly: true,
    railGroup: 'help',
  },
  'whats-new': { id: 'whats-new', kind: 'utility', railGroup: 'help' },
  'account-settings': { id: 'account-settings', kind: 'utility', inAccountingOnly: true },
  admin: { id: 'admin', kind: 'utility', platformAdminOnly: true },
};

export const BUSINESS_APP_IDS: readonly string[] = Object.values(APP_REGISTRY)
  .filter((app) => app.kind === 'business')
  .map((app) => app.id);

export interface AppStateInput {
  /** `normalizePlanFeatures` output for the active plan, add-ons merged. */
  planFeatures: Record<string, boolean | number>;
  planCode: string | null;
  /** Platform switches with this tenant's overrides applied. */
  platformFeatures: PlatformFeatures;
  /** `Tenant.hidden_apps`. */
  hiddenApps: readonly string[];
  isOwner: boolean;
  /** What the member holds in this workspace. */
  permissions: readonly string[];
  isPlatformAdmin?: boolean;
}

/**
 * The one module-level gate for the tenant shell: which apps exist for this
 * workspace and member, and in what state. Link-level permissions are not
 * decided here — the sidebar's `NAV_PERMISSIONS` pass runs after this.
 */
export function resolveAppStates(input: AppStateInput): Record<string, AppState> {
  const hidden = new Set(input.hiddenApps);
  const paid = Boolean(input.planCode) && input.planCode !== 'FREE';
  const accountingOnly = Boolean(input.planFeatures.accountingOnly);
  const states: Record<string, AppState> = {};
  for (const app of Object.values(APP_REGISTRY)) {
    states[app.id] = stateOf(app, input, hidden, paid, accountingOnly);
  }
  return states;
}

function stateOf(
  app: AppDefinition,
  input: AppStateInput,
  hidden: ReadonlySet<string>,
  paid: boolean,
  accountingOnly: boolean,
): AppState {
  if (app.platformAdminOnly) return input.isPlatformAdmin ? 'available' : 'unavailable';
  if (accountingOnly && !app.inAccountingOnly) return 'unavailable';
  if (app.platformFeature && !input.platformFeatures[app.platformFeature]) return 'unavailable';
  if (app.platformFeatureAny && !app.platformFeatureAny.some((key) => input.platformFeatures[key])) {
    return 'unavailable';
  }

  const granted = (!app.entitlement || hasPlanEntitlement(input.planFeatures, app.entitlement))
    && (!app.requiresPaidPlan || paid);
  if (!granted) return 'locked';

  if (
    app.permissionsAny
    && !input.isOwner
    && !app.permissionsAny.some((permission) => input.permissions.includes(permission))
  ) {
    return 'unavailable';
  }
  if (app.kind === 'business' && hidden.has(app.id)) return 'hidden';
  return 'available';
}

/** Narrows an untrusted list (Prisma column, request body) to business app ids. */
export function sanitizeHiddenApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const kept = new Set<string>();
  for (const id of raw) {
    if (typeof id === 'string' && APP_REGISTRY[id]?.kind === 'business') kept.add(id);
  }
  return [...kept];
}
