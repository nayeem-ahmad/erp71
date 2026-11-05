/*
 * The designation master: departments, levels and designations, and reading
 * all three from one workbook.
 *
 * SheetJS is imported inside `readOrgWorkbook`, never at the top, for the same
 * reason as `spreadsheet.ts`: it is hundreds of kilobytes and only the import
 * dialog needs it.
 */

export interface DepartmentRef {
    id: string;
    name: string;
    code?: string | null;
    is_active?: boolean;
}

export interface Department extends DepartmentRef {
    description?: string | null;
    reports_to?: string | null;
    created_at?: string;
    _count?: { employees: number; designations: number };
}

export interface DesignationLevel {
    id: string;
    level: number;
    name: string;
    is_active?: boolean;
    created_at?: string;
    _count?: { designations: number };
}

export interface Designation {
    id: string;
    name: string;
    code?: string | null;
    department_id?: string | null;
    level_id?: string | null;
    reports_to_id?: string | null;
    reports_to_note?: string | null;
    remarks?: string | null;
    is_active?: boolean;
    created_at?: string;
    department?: DepartmentRef | null;
    level?: Pick<DesignationLevel, 'id' | 'level' | 'name' | 'is_active'> | null;
    reportsTo?: { id: string; name: string; code?: string | null; is_active?: boolean } | null;
    _count?: { employees: number };
}

/** `IMP-04 · Import & Shipping Executive`, or just the name when there is no code. */
export function codeLabel(item: { name: string; code?: string | null } | null | undefined): string {
    if (!item) return '';
    return item.code ? `${item.code} · ${item.name}` : item.name;
}

/** `Level 3 · Department Head`. */
export function levelLabel(level: { level: number; name: string } | null | undefined, word = 'Level'): string {
    if (!level) return '';
    return `${word} ${level.level} · ${level.name}`;
}

/**
 * Who a designation reports to, in words: the reporting designation, or the
 * free-text note ("Shareholders") when the line ends outside the chart.
 */
export function reportsToLabel(designation: Pick<Designation, 'reportsTo' | 'reports_to_note'> | null | undefined): string {
    if (!designation) return '';
    if (designation.reportsTo) return codeLabel(designation.reportsTo);
    return designation.reports_to_note ?? '';
}

/**
 * What a picker may offer: active records, plus the one already chosen even if
 * it has since been deactivated — otherwise editing an old record would blank
 * its designation without anyone asking for that.
 */
export function pickable<T extends { id: string; is_active?: boolean }>(items: T[], currentId?: string | null): T[] {
    return items.filter((item) => item.is_active !== false || item.id === currentId);
}

/**
 * Designations bucketed by department for `<optgroup>`s, in the order the
 * designations arrive (the API sorts by code). Ones with no department come
 * last under `otherLabel`.
 */
export function groupByDepartment(designations: Designation[], otherLabel: string): { label: string; items: Designation[] }[] {
    const groups = new Map<string, { label: string; items: Designation[] }>();
    const other: Designation[] = [];
    for (const d of designations) {
        if (!d.department) { other.push(d); continue; }
        const key = d.department.id;
        if (!groups.has(key)) groups.set(key, { label: codeLabel(d.department), items: [] });
        groups.get(key)!.items.push(d);
    }
    const out = [...groups.values()];
    if (other.length) out.push({ label: otherLabel, items: other });
    return out;
}

// ── Workbook ──────────────────────────────────────────────────────────────────

export type OrgSheetKind = 'levels' | 'departments' | 'designations';

export interface OrgWorkbook {
    levels: Record<string, string>[];
    departments: Record<string, string>[];
    designations: Record<string, string>[];
    /** Which tab each kind was read from, for the preview. */
    sheets: Partial<Record<OrgSheetKind, string>>;
    /** Tabs that matched none of the three. */
    ignored: string[];
}

/** Lower-case letters and digits only: "Level (1 = Highest)" → "level1highest". */
export function normaliseHeader(header: string): string {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The headers each field answers to, already normalised. The first spelling of
 * each is the tenant template's own; the rest are what people type instead.
 */
const FIELD_ALIASES: Record<OrgSheetKind, Record<string, string[]>> = {
    designations: {
        code: ['designationcode', 'code', 'desigcode', 'designationid'],
        name: ['designationname', 'designation', 'name', 'title', 'jobtitle'],
        department_code: ['departmentcode', 'deptcode'],
        department_name: ['departmentname', 'department', 'dept'],
        level: ['level1highest', 'level', 'levelno', 'levelnumber', 'grade'],
        level_name: ['levelname', 'gradename'],
        reports_to_code: ['reportstocode', 'reportingcode', 'reportstodesignationcode'],
        reports_to_name: ['reportstodesignation', 'reportsto', 'reportingdesignation', 'reportingto'],
        remarks: ['remarks', 'remark', 'notes', 'note'],
        status: ['status', 'active'],
    },
    departments: {
        code: ['departmentcode', 'code', 'deptcode'],
        name: ['departmentname', 'department', 'name'],
        description: ['description', 'details'],
        reports_to: ['reportsto', 'reporting', 'reportingto'],
        status: ['status', 'active'],
    },
    levels: {
        level: ['level', 'level1highest', 'levelno', 'levelnumber'],
        name: ['levelname', 'name'],
        status: ['status', 'active'],
    },
};

/**
 * Which of the three a sheet is, from its headers — not its tab name, which
 * people rename freely. A designation sheet is the one with a designation
 * column; a department sheet has a department column but no designation; a
 * level sheet has a level-name column and neither.
 */
export function detectSheetKind(headers: string[]): OrgSheetKind | null {
    const h = new Set(headers.map(normaliseHeader));
    const any = (...names: string[]) => names.some((n) => h.has(n));
    if (any('designationcode', 'designationname', 'designation')) return 'designations';
    if (any('departmentcode', 'departmentname', 'department')) return 'departments';
    if (any('levelname') && any('level', 'level1highest', 'levelno', 'levelnumber')) return 'levels';
    return null;
}

/**
 * Re-keys a sheet's rows to the import's field names. Only known fields are
 * kept — the API rejects any other key — and every value becomes trimmed text.
 */
export function mapSheetRows(kind: OrgSheetKind, rows: Record<string, unknown>[]): Record<string, string>[] {
    if (rows.length === 0) return [];
    const headers = Object.keys(rows[0]);
    const byNormal = new Map(headers.map((header) => [normaliseHeader(header), header]));
    const columnFor: Record<string, string> = {};
    const taken = new Set<string>();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES[kind])) {
        const header = aliases.map((a) => byNormal.get(a)).find((x) => x !== undefined && !taken.has(x));
        if (header !== undefined) {
            columnFor[field] = header;
            taken.add(header);
        }
    }
    return rows.map((row) => {
        const out: Record<string, string> = {};
        for (const [field, header] of Object.entries(columnFor)) {
            const value = row[header];
            out[field] = value == null ? '' : String(value).trim();
        }
        return out;
    });
}

/**
 * Sorts the tabs of a workbook into levels, departments and designations.
 * When two tabs look like the same kind, the first wins and the other is
 * reported as ignored.
 */
export function classifySheets(sheets: { name: string; rows: Record<string, unknown>[] }[]): OrgWorkbook {
    const out: OrgWorkbook = { levels: [], departments: [], designations: [], sheets: {}, ignored: [] };
    for (const sheet of sheets) {
        const headers = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [];
        const kind = detectSheetKind(headers);
        if (!kind || out.sheets[kind]) { out.ignored.push(sheet.name); continue; }
        out.sheets[kind] = sheet.name;
        out[kind] = mapSheetRows(kind, sheet.rows);
    }
    return out;
}

/** Reads every tab of an .xlsx/.xls (or a single .csv) and classifies it. */
export async function readOrgWorkbook(file: File): Promise<OrgWorkbook> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
        throw new Error(`Unsupported file type ".${ext ?? ''}". Please upload a .xlsx or .csv file.`);
    }
    const [buffer, XLSX] = await Promise.all([file.arrayBuffer(), import('xlsx')]);
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheets = wb.SheetNames.map((name) => ({
        name,
        // `raw: false` gives the cell as the sheet shows it, so a level typed
        // as 3 does not arrive as 3.0000001 from a formula.
        rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: false }),
    }));
    return classifySheets(sheets);
}

export interface OrgSheetResult {
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
}

export interface OrgImportResult {
    dry_run: boolean;
    applied: boolean;
    levels: OrgSheetResult;
    departments: OrgSheetResult;
    designations: OrgSheetResult;
    errors: string[];
}
