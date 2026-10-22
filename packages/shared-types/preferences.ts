/**
 * What a member of a workspace has set up for themselves, and the profile a
 * workspace can hand to new staff so they do not start from a blank slate.
 *
 * Every preference belongs to a *section* (invoice layout, list look, saved
 * columns, sidebar, alerts, and the till's device settings). A value is
 * resolved section by section from up to four layers, most specific first:
 *
 *   member   what the person chose themselves
 *   browser  answers this browser still holds from before preferences moved to
 *            the server — read only for sections listed in
 *            `LEGACY_BROWSER_SECTIONS`, and only until the member has answered
 *   profile  the workspace's default profile for the member's role
 *   default  the built-in value, exactly how the app behaved before profiles
 *
 * Inside a section the layers merge field by field, so a member who changes one
 * option keeps the profile's others — except where a value is only meaningful
 * whole, which is replaced rather than merged: a list's saved columns, a list's
 * look override, the open sidebar groups, the muted alert types. With no profile
 * and no answers the result is today's behaviour.
 *
 * Shared because the API validates what it stores with the same normalisers the
 * screens use to read it, and two copies of a limit drift the first time one
 * side changes it. Nothing here throws: a stored blob may be old, hand-edited or
 * from a build that knew other options, so every normaliser drops what it cannot
 * read and keeps the rest.
 */

import {
  DEFAULT_INVOICE_PRINT_PREFS,
  normalizeInvoicePrintPrefsPartial,
  type InvoicePrintPrefs,
} from './invoice-print';
import { DEFAULT_TABLE_VIEW, sanitizeTableView, type TableViewSettings } from './table-view';

/** Sections that follow the person, whichever till or browser they sign in at. */
export const PERSON_SECTIONS = ['invoicePrint', 'tableView', 'tableColumns', 'sidebar', 'alerts'] as const;
export type PersonSectionKey = (typeof PERSON_SECTIONS)[number];

/**
 * Every section a profile can set. `device` describes the till rather than the
 * person (paper size, print scale), so a profile may preset it but a member
 * never owns an answer there.
 */
export const PREFERENCE_SECTIONS = [...PERSON_SECTIONS, 'device'] as const;
export type PreferenceSectionKey = (typeof PREFERENCE_SECTIONS)[number];

/** Sections a browser used to keep in localStorage before they were saved on the server. */
export const LEGACY_BROWSER_SECTIONS = ['tableView', 'tableColumns', 'sidebar'] as const;
export type LegacyBrowserSection = (typeof LEGACY_BROWSER_SECTIONS)[number];

export interface TableViewPrefs {
  /** The look every list gets unless it has an override. */
  global: TableViewSettings;
  /** Per-list overrides, keyed by list id. */
  tables: Record<string, TableViewSettings>;
}

export interface TableColumnsEntry {
  hidden?: string[];
  order?: string[];
  pageSize?: number;
}
/** Saved columns per list, keyed by list id. */
export type TableColumnsPrefs = Record<string, TableColumnsEntry>;

export interface SidebarPrefs {
  appShellOpenGroups?: string[];
}

export interface AlertPrefs {
  mutedTypes: string[];
  /** Minutes after midnight; the window may wrap past midnight (22:00 to 08:00). */
  quiet: { enabled: boolean; from: number; to: number };
}

export const PREFERENCE_PAPER_SIZES = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'] as const;
const PRINT_DENSITIES = ['normal', 'compact'] as const;
const PRINT_TYPE_SCALES = ['normal', 'large', 'larger'] as const;

export interface DevicePrefs {
  paperSize?: (typeof PREFERENCE_PAPER_SIZES)[number];
  printDensity?: (typeof PRINT_DENSITIES)[number];
  printTypeScale?: (typeof PRINT_TYPE_SCALES)[number];
  skipPreview?: boolean;
  sidebarCollapsed?: boolean;
}

export interface SectionValues {
  invoicePrint: InvoicePrintPrefs;
  tableView: TableViewPrefs;
  tableColumns: TableColumnsPrefs;
  sidebar: SidebarPrefs;
  alerts: AlertPrefs;
  device: DevicePrefs;
}

/**
 * What one layer says about each section — only the fields it answered.
 *
 * Fields nested inside a section are partial too, though the types do not say
 * so: a profile's `tableView.global` may hold just `density`, and its
 * `alerts.quiet` just `from`. `normalizeSectionPartial` produces exactly that.
 */
export type SectionPartials = { [K in PreferenceSectionKey]?: Partial<SectionValues[K]> };

export interface PreferenceProfilePrefs {
  version: 1;
  sections: SectionPartials;
}

/** What a member has saved for themselves on the server (person sections only). */
export interface MemberPreferences {
  version: 1;
  tableView?: Partial<TableViewPrefs>;
  tableColumns?: TableColumnsPrefs;
  sidebar?: SidebarPrefs;
}

export type PreferenceSource = 'member' | 'browser' | 'profile' | 'default';

export type ResolvedPreferences = {
  [K in PreferenceSectionKey]: { value: SectionValues[K]; source: PreferenceSource };
};

export interface MyPreferencesResponse {
  profile: { id: string; name: string } | null;
  /** Sections the member has not answered yet, so the browser's old answers still count. */
  legacy_browser_sections: LegacyBrowserSection[];
  sections: ResolvedPreferences;
}

export interface PreferenceProfileSummary {
  id: string;
  name: string;
  is_default: boolean;
  roles: { id: string; name: string }[];
  updated_at: string;
}

export interface PreferenceProfileDetail extends PreferenceProfileSummary {
  sections: SectionPartials;
}

/** No muted types, quiet hours on, 22:00 to 08:00 — how alerts behaved before this was configurable. */
export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  mutedTypes: [],
  quiet: { enabled: true, from: 1320, to: 480 },
};

export const DEFAULT_SECTION_VALUES: SectionValues = {
  invoicePrint: DEFAULT_INVOICE_PRINT_PREFS,
  tableView: { global: DEFAULT_TABLE_VIEW, tables: {} },
  tableColumns: {},
  sidebar: {},
  alerts: DEFAULT_ALERT_PREFS,
  device: {},
};

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

/** List, column and sidebar group ids: a leading alphanumeric, then up to 79 of `A-Za-z0-9_.:-`. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const MAX_LISTS = 300;
const MAX_COLUMN_IDS = 100;
const MAX_SIDEBAR_GROUPS = 50;
const PAGE_SIZE = { min: 1, max: 500 } as const;
const MAX_MUTED_TYPES = 100;
const MAX_MUTED_TYPE_LENGTH = 80;
const MINUTES_IN_DAY = 1440;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/** Valid, distinct ids from a list, at most `max`; `undefined` when it is not a list at all. */
function idList(raw: unknown, max: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id));
  return [...new Set(ids)].slice(0, max);
}

/**
 * Keeps the first `MAX_LISTS` entries whose key is a valid id and whose value
 * `read` accepts. Stale ids from a renamed list are dropped here rather than
 * left to pile up.
 */
function listMap<T>(raw: unknown, read: (entry: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(raw)) return out;
  let count = 0;
  for (const [id, entry] of Object.entries(raw)) {
    if (count >= MAX_LISTS) break;
    if (!ID_PATTERN.test(id)) continue;
    const value = read(entry);
    if (value === undefined) continue;
    out[id] = value;
    count += 1;
  }
  return out;
}

function readColumnsEntry(raw: unknown): TableColumnsEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const entry: TableColumnsEntry = {};
  const hidden = idList(raw.hidden, MAX_COLUMN_IDS);
  if (hidden) entry.hidden = hidden;
  const order = idList(raw.order, MAX_COLUMN_IDS);
  if (order) entry.order = order;
  if (
    typeof raw.pageSize === 'number' &&
    Number.isInteger(raw.pageSize) &&
    raw.pageSize >= PAGE_SIZE.min &&
    raw.pageSize <= PAGE_SIZE.max
  ) {
    entry.pageSize = raw.pageSize;
  }
  return entry;
}

function readTableView(raw: unknown): Partial<TableViewPrefs> {
  if (!isRecord(raw)) return {};
  const out: Partial<TableViewPrefs> = {};
  const global = sanitizeTableView(raw.global);
  // Partial on purpose: a layer states only the settings it answered.
  if (Object.keys(global).length > 0) out.global = global as TableViewSettings;
  const tables = listMap(raw.tables, (entry) => (isRecord(entry) ? (sanitizeTableView(entry) as TableViewSettings) : undefined));
  if (Object.keys(tables).length > 0) out.tables = tables;
  return out;
}

function readSidebar(raw: unknown): SidebarPrefs {
  if (!isRecord(raw)) return {};
  const groups = idList(raw.appShellOpenGroups, MAX_SIDEBAR_GROUPS);
  return groups ? { appShellOpenGroups: groups } : {};
}

function minuteOfDay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MINUTES_IN_DAY
    ? value
    : undefined;
}

function readAlerts(raw: unknown): Partial<AlertPrefs> {
  if (!isRecord(raw)) return {};
  const out: Partial<AlertPrefs> = {};
  if (Array.isArray(raw.mutedTypes)) {
    const types = raw.mutedTypes.filter(
      (type): type is string => typeof type === 'string' && type.length > 0 && type.length <= MAX_MUTED_TYPE_LENGTH,
    );
    out.mutedTypes = [...new Set(types)].slice(0, MAX_MUTED_TYPES);
  }
  if (isRecord(raw.quiet)) {
    const quiet: Partial<AlertPrefs['quiet']> = {};
    if (typeof raw.quiet.enabled === 'boolean') quiet.enabled = raw.quiet.enabled;
    const from = minuteOfDay(raw.quiet.from);
    if (from !== undefined) quiet.from = from;
    const to = minuteOfDay(raw.quiet.to);
    if (to !== undefined) quiet.to = to;
    // Partial on purpose: quiet hours merge field by field across layers.
    if (Object.keys(quiet).length > 0) out.quiet = quiet as AlertPrefs['quiet'];
  }
  return out;
}

function readDevice(raw: unknown): DevicePrefs {
  if (!isRecord(raw)) return {};
  const out: DevicePrefs = {};
  if (isOneOf(PREFERENCE_PAPER_SIZES, raw.paperSize)) out.paperSize = raw.paperSize;
  if (isOneOf(PRINT_DENSITIES, raw.printDensity)) out.printDensity = raw.printDensity;
  if (isOneOf(PRINT_TYPE_SCALES, raw.printTypeScale)) out.printTypeScale = raw.printTypeScale;
  if (typeof raw.skipPreview === 'boolean') out.skipPreview = raw.skipPreview;
  if (typeof raw.sidebarCollapsed === 'boolean') out.sidebarCollapsed = raw.sidebarCollapsed;
  return out;
}

/**
 * Reads one section of a stored or submitted blob as only the answers it gives.
 * Anything unreadable is dropped, and a section with nothing valid reads as `{}`.
 */
export function normalizeSectionPartial<K extends PreferenceSectionKey>(
  key: K,
  raw: unknown,
): Partial<SectionValues[K]> {
  let out: unknown;
  switch (key) {
    case 'invoicePrint':
      out = normalizeInvoicePrintPrefsPartial(raw);
      break;
    case 'tableView':
      out = readTableView(raw);
      break;
    case 'tableColumns':
      out = listMap(raw, readColumnsEntry);
      break;
    case 'sidebar':
      out = readSidebar(raw);
      break;
    case 'alerts':
      out = readAlerts(raw);
      break;
    case 'device':
      out = readDevice(raw);
      break;
    default:
      out = {};
  }
  return out as Partial<SectionValues[K]>;
}

function hasAnswers(partial: object | undefined): boolean {
  return !!partial && Object.keys(partial).length > 0;
}

/** Reads a stored profile blob. Unknown sections and unreadable fields are dropped. */
export function normalizeProfilePrefs(raw: unknown): PreferenceProfilePrefs {
  const sections: SectionPartials = {};
  const rawSections = isRecord(raw) && isRecord(raw.sections) ? raw.sections : {};
  for (const key of PREFERENCE_SECTIONS) {
    const partial = normalizeSectionPartial(key, rawSections[key]);
    if (hasAnswers(partial)) (sections as Record<string, unknown>)[key] = partial;
  }
  return { version: 1, sections };
}

/** Reads a member's stored answers. Only the sections a member owns are kept. */
export function normalizeMemberPreferences(raw: unknown): MemberPreferences {
  const out: MemberPreferences = { version: 1 };
  if (!isRecord(raw)) return out;
  const tableView = readTableView(raw.tableView);
  if (hasAnswers(tableView)) out.tableView = tableView;
  const tableColumns = normalizeSectionPartial('tableColumns', raw.tableColumns);
  if (hasAnswers(tableColumns)) out.tableColumns = tableColumns;
  const sidebar = readSidebar(raw.sidebar);
  if (hasAnswers(sidebar)) out.sidebar = sidebar;
  return out;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

type Layer = Record<string, any>;

/** Merges layers (least specific first) over the built-in value of one section. */
function mergeSection<K extends PreferenceSectionKey>(key: K, layers: Layer[]): SectionValues[K] {
  let out: unknown;
  switch (key) {
    case 'invoicePrint':
      out = Object.assign({}, DEFAULT_INVOICE_PRINT_PREFS, ...layers);
      break;
    case 'tableView':
      out = {
        global: Object.assign({}, DEFAULT_TABLE_VIEW, ...layers.map((layer) => layer.global)),
        // A list's override is one decision, so the most specific layer's entry wins whole.
        tables: Object.assign({}, ...layers.map((layer) => layer.tables)),
      };
      break;
    case 'tableColumns':
      // Likewise: hidden, order and page size describe one arrangement.
      out = Object.assign({}, ...layers);
      break;
    case 'sidebar':
      out = Object.assign({}, ...layers);
      break;
    case 'alerts':
      out = {
        mutedTypes: [...(layers.map((layer) => layer.mutedTypes).filter(Boolean).pop() ?? DEFAULT_ALERT_PREFS.mutedTypes)],
        quiet: Object.assign({}, DEFAULT_ALERT_PREFS.quiet, ...layers.map((layer) => layer.quiet)),
      };
      break;
    default:
      // device: only what a layer set, never filled with built-ins.
      out = Object.assign({}, ...layers);
  }
  return out as SectionValues[K];
}

function isLegacySection(key: PreferenceSectionKey): key is LegacyBrowserSection {
  return (LEGACY_BROWSER_SECTIONS as readonly string[]).includes(key);
}

/**
 * Works out what a member sees: per section, the built-in value overlaid with
 * the profile, then the browser's leftovers, then the member's own answers.
 * `source` names the most specific layer that answered anything in the section.
 *
 * Every layer is normalised on the way in, so a hand-edited row or an old
 * browser blob cannot make this throw.
 */
export function resolvePreferences(input: {
  profile?: PreferenceProfilePrefs | null;
  member?: SectionPartials;
  legacy?: { [K in LegacyBrowserSection]?: unknown };
}): ResolvedPreferences {
  const profile = normalizeProfilePrefs(input.profile).sections;
  const member = input.member ?? {};
  const legacy = input.legacy ?? {};

  const out = {} as Record<PreferenceSectionKey, { value: unknown; source: PreferenceSource }>;
  for (const key of PREFERENCE_SECTIONS) {
    const candidates: Array<{ source: PreferenceSource; partial: Layer }> = [
      { source: 'profile', partial: profile[key] ?? {} },
      { source: 'browser', partial: isLegacySection(key) ? normalizeSectionPartial(key, legacy[key]) : {} },
      // The device is the till's, not the person's: a member never owns an answer there.
      { source: 'member', partial: key === 'device' ? {} : normalizeSectionPartial(key, member[key]) },
    ];
    const layers = candidates.filter((layer) => hasAnswers(layer.partial));

    out[key] = {
      value: mergeSection(key, layers.map((layer) => layer.partial)),
      source: layers.length > 0 ? layers[layers.length - 1].source : 'default',
    };
  }
  return out as ResolvedPreferences;
}
