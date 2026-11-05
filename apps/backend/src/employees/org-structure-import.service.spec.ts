import { OrgStructureImportService } from './org-structure-import.service';

/**
 * A tenant's three master tables held in arrays, with just the Prisma calls the
 * importer makes. Writes land in the arrays, so a test can import and then read
 * back what the ERP would hold.
 */
function fakeDb(seed: { levels?: any[]; departments?: any[]; designations?: any[] } = {}) {
    const tables: Record<string, any[]> = {
        designationLevel: (seed.levels ?? []).map((r) => ({ deleted_at: null, is_active: true, ...r })),
        department: (seed.departments ?? []).map((r) => ({
            deleted_at: null, is_active: true, code: null, description: null, reports_to: null, ...r,
        })),
        designation: (seed.designations ?? []).map((r) => ({
            deleted_at: null, is_active: true, code: null, department_id: null, level_id: null,
            reports_to_id: null, reports_to_note: null, remarks: null, ...r,
        })),
    };
    const model = (name: string) => ({
        findMany: jest.fn(async () => tables[name].map((r) => ({ ...r }))),
        create: jest.fn(async ({ data }: any) => {
            const row = { deleted_at: null, ...data };
            tables[name].push(row);
            return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
            const row = tables[name].find((r) => r.id === where.id);
            if (!row) throw new Error(`no ${name} ${where.id}`);
            for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
            return row;
        }),
    });
    const db: any = {
        tables,
        designationLevel: model('designationLevel'),
        department: model('department'),
        designation: model('designation'),
    };
    db.$transaction = jest.fn(async (cb: any) => cb(db));
    return db;
}

const LEVELS = [
    { level: '1', name: 'Board / Top Management' },
    { level: '2', name: 'Executive Leadership' },
    { level: '3', name: 'Department Head' },
    { level: '6', name: 'Executive / Officer' },
];

const DEPARTMENTS = [
    { code: 'BRD', name: 'Board', description: 'Board of Directors', reports_to: 'Shareholders', status: 'Active' },
    { code: 'MGT', name: 'Management', reports_to: 'Board', status: 'Active' },
    { code: 'IMP', name: 'Import & Sourcing', reports_to: 'CEO', status: 'Active' },
];

// Deliberately out of order: IMP-04 reports to IMP-01, which comes after it.
const DESIGNATIONS = [
    {
        code: 'IMP-04', name: 'Import & Shipping Executive', department_code: 'IMP', department_name: 'Import & Sourcing',
        level: '6', level_name: 'Executive / Officer', reports_to_code: 'IMP-01', reports_to_name: 'Head of Import', status: 'Active',
    },
    {
        code: 'BRD-01', name: 'Chairman', department_code: 'BRD', department_name: 'Board', level: '1',
        level_name: 'Board / Top Management', reports_to_code: '', reports_to_name: 'Shareholders', remarks: 'Shareholders', status: 'Active',
    },
    {
        code: 'MGT-02', name: 'Chief Executive Officer', department_code: 'MGT', department_name: 'Management', level: '2',
        level_name: 'Executive Leadership', reports_to_code: 'BRD-01', reports_to_name: 'Chairman', status: 'Active',
    },
    {
        code: 'IMP-01', name: 'Head of Import', department_code: 'IMP', department_name: 'Import & Sourcing', level: '3',
        level_name: 'Department Head', reports_to_code: 'MGT-02', reports_to_name: 'Chief Executive Officer', status: 'Active',
    },
];

const workbook = () => ({ levels: LEVELS, departments: DEPARTMENTS, designations: DESIGNATIONS });

describe('OrgStructureImportService', () => {
    it('imports levels, departments and designations with their reporting lines', async () => {
        const db = fakeDb();
        const service = new OrgStructureImportService(db);

        const result = await service.import('t1', { ...workbook(), mode: 'skip' });

        expect(result.errors).toEqual([]);
        expect(result.applied).toBe(true);
        expect(result.levels.created).toBe(4);
        expect(result.departments.created).toBe(3);
        expect(result.designations.created).toBe(4);

        const byCode = (code: string) => db.tables.designation.find((d: any) => d.code === code);
        expect(byCode('IMP-04').reports_to_id).toBe(byCode('IMP-01').id);
        expect(byCode('IMP-01').reports_to_id).toBe(byCode('MGT-02').id);
        expect(byCode('BRD-01').reports_to_id).toBeNull();
        expect(byCode('BRD-01').reports_to_note).toBe('Shareholders');

        const imp = db.tables.department.find((d: any) => d.code === 'IMP');
        expect(byCode('IMP-04').department_id).toBe(imp.id);
        const level6 = db.tables.designationLevel.find((l: any) => l.level === 6);
        expect(byCode('IMP-04').level_id).toBe(level6.id);
        expect(byCode('IMP-04').tenant_id).toBe('t1');
    });

    it('writes nothing on a dry run but reports what would happen', async () => {
        const db = fakeDb();
        const result = await new OrgStructureImportService(db).import('t1', { ...workbook(), mode: 'skip', dry_run: true });

        expect(result.dry_run).toBe(true);
        expect(result.applied).toBe(false);
        expect(result.designations.created).toBe(4);
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.tables.designation).toHaveLength(0);
    });

    it('stores codes upper-case and matches them case-insensitively', async () => {
        const db = fakeDb();
        const lowerCase = DESIGNATIONS.map((d) => ({ ...d, code: d.code.toLowerCase(), reports_to_code: d.reports_to_code.toLowerCase() }));
        const result = await new OrgStructureImportService(db).import('t1', {
            levels: LEVELS, departments: DEPARTMENTS, designations: lowerCase, mode: 'skip',
        });

        expect(result.errors).toEqual([]);
        expect(db.tables.designation.map((d: any) => d.code).sort()).toEqual(['BRD-01', 'IMP-01', 'IMP-04', 'MGT-02']);
    });

    it('blocks the whole import when any row is wrong', async () => {
        const db = fakeDb();
        const broken = [...DESIGNATIONS, { ...DESIGNATIONS[0], code: 'IMP-09', name: 'Ghost', reports_to_code: 'NOPE-1' }];

        const result = await new OrgStructureImportService(db).import('t1', {
            levels: LEVELS, departments: DEPARTMENTS, designations: broken, mode: 'skip',
        });

        expect(result.applied).toBe(false);
        expect(result.errors).toEqual([
            'Designation sheet row 6: reports to NOPE-1, which is not in the Designation sheet or the ERP.',
        ]);
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a code used twice in the file', async () => {
        const db = fakeDb();
        const result = await new OrgStructureImportService(db).import('t1', {
            ...workbook(),
            designations: [...DESIGNATIONS, { ...DESIGNATIONS[1], name: 'Vice Chairman' }],
            mode: 'skip',
        });

        expect(result.errors).toEqual(['Designation sheet row 6: code BRD-01 appears more than once.']);
    });

    it('refuses a reporting loop', async () => {
        const db = fakeDb();
        const looped = DESIGNATIONS.map((d) => (d.code === 'BRD-01' ? { ...d, reports_to_code: 'IMP-04' } : d));
        const result = await new OrgStructureImportService(db).import('t1', {
            levels: LEVELS, departments: DEPARTMENTS, designations: looped, mode: 'skip',
        });

        expect(result.applied).toBe(false);
        expect(result.errors.some((e) => e.includes('loops back'))).toBe(true);
    });

    it('reads Inactive as a deactivated designation and rejects an unknown status', async () => {
        const db = fakeDb();
        const result = await new OrgStructureImportService(db).import('t1', {
            ...workbook(),
            designations: DESIGNATIONS.map((d) => (d.code === 'IMP-04' ? { ...d, status: 'Inactive' } : d)),
            mode: 'skip',
        });
        expect(result.errors).toEqual([]);
        expect(db.tables.designation.find((d: any) => d.code === 'IMP-04').is_active).toBe(false);

        const bad = await new OrgStructureImportService(fakeDb()).import('t1', {
            ...workbook(),
            designations: DESIGNATIONS.map((d) => (d.code === 'IMP-04' ? { ...d, status: 'Maybe' } : d)),
            mode: 'skip',
        });
        expect(bad.errors).toEqual(['Designation sheet row 2: status "Maybe" should be Active or Inactive.']);
    });

    it('creates a department and level a designation-only sheet names', async () => {
        const db = fakeDb();
        const result = await new OrgStructureImportService(db).import('t1', { designations: DESIGNATIONS, mode: 'skip' });

        expect(result.errors).toEqual([]);
        expect(result.departments.created).toBe(3);
        expect(result.levels.created).toBe(4);
        expect(db.tables.department.find((d: any) => d.code === 'IMP').name).toBe('Import & Sourcing');
        expect(db.tables.designationLevel.find((l: any) => l.level === 3).name).toBe('Department Head');
    });

    it('re-importing the same file changes nothing', async () => {
        const db = fakeDb();
        const service = new OrgStructureImportService(db);
        await service.import('t1', { ...workbook(), mode: 'skip' });

        const again = await service.import('t1', { ...workbook(), mode: 'upsert' });

        expect(again.errors).toEqual([]);
        expect(again.designations).toEqual({ created: 0, updated: 0, unchanged: 4, skipped: 0 });
        expect(again.departments).toEqual({ created: 0, updated: 0, unchanged: 3, skipped: 0 });
        expect(again.levels).toEqual({ created: 0, updated: 0, unchanged: 4, skipped: 0 });
        expect(db.tables.designation).toHaveLength(4);
    });

    it('updates from a corrected file in upsert mode, and leaves records alone in skip mode', async () => {
        const db = fakeDb();
        const service = new OrgStructureImportService(db);
        await service.import('t1', { ...workbook(), mode: 'skip' });
        const renamed = DESIGNATIONS.map((d) => (d.code === 'IMP-04' ? { ...d, name: 'Shipping Executive' } : d));

        const skipped = await service.import('t1', { ...workbook(), designations: renamed, mode: 'skip' });
        expect(skipped.designations.skipped).toBe(4);
        expect(db.tables.designation.find((d: any) => d.code === 'IMP-04').name).toBe('Import & Shipping Executive');

        const upserted = await service.import('t1', { ...workbook(), designations: renamed, mode: 'upsert' });
        expect(upserted.designations.updated).toBe(1);
        expect(db.tables.designation.find((d: any) => d.code === 'IMP-04').name).toBe('Shipping Executive');
    });

    it('gives a code to an existing designation of the same name instead of duplicating it', async () => {
        const db = fakeDb({ designations: [{ id: 'old-driver', tenant_id: 't1', name: 'Head of Import' }] });

        const result = await new OrgStructureImportService(db).import('t1', { ...workbook(), mode: 'upsert' });

        expect(result.errors).toEqual([]);
        expect(result.designations.created).toBe(3);
        expect(result.designations.updated).toBe(1);
        const row = db.tables.designation.find((d: any) => d.id === 'old-driver');
        expect(row.code).toBe('IMP-01');
        expect(db.tables.designation).toHaveLength(4);
    });

    it('brings back a deleted designation of the same name rather than colliding with it', async () => {
        const db = fakeDb({
            designations: [{ id: 'gone', tenant_id: 't1', name: 'Chairman', deleted_at: new Date('2026-01-01') }],
        });

        const result = await new OrgStructureImportService(db).import('t1', { ...workbook(), mode: 'skip' });

        expect(result.errors).toEqual([]);
        const row = db.tables.designation.find((d: any) => d.id === 'gone');
        expect(row.deleted_at).toBeNull();
        expect(row.code).toBe('BRD-01');
        expect(db.tables.designation).toHaveLength(4);
    });

    it('ignores blank lines', async () => {
        const db = fakeDb();
        const result = await new OrgStructureImportService(db).import('t1', {
            levels: [...LEVELS, { level: '', name: '' }],
            departments: [...DEPARTMENTS, { code: '', name: '' }],
            designations: [...DESIGNATIONS, { code: '', name: '' }],
            mode: 'skip',
        });
        expect(result.errors).toEqual([]);
        expect(result.designations.created).toBe(4);
    });
});
