import {
    classifySheets, codeLabel, detectSheetKind, groupByDepartment, levelLabel, mapSheetRows,
    normaliseHeader, pickable, reportsToLabel, type Designation,
} from './org-structure';

// The headers of the tenant template this importer was built for.
const DESIGNATION_ROW = {
    'Designation Code': 'IMP-04',
    'Designation Name': 'Import & Shipping Executive',
    'Department Code': 'IMP',
    'Department Name': 'Import & Sourcing',
    'Level (1 = Highest)': '6',
    'Level Name': 'Executive / Officer',
    'Reports To (Code)': 'IMP-02',
    'Reports To (Designation)': 'Sourcing Manager',
    Remarks: '',
    Status: 'Active',
};
const DEPARTMENT_ROW = {
    'Department Code': 'IMP',
    'Department Name': 'Import & Sourcing',
    Description: 'China sourcing, PO/PI/L/C, shipping, customs, licensing',
    'Reports To': 'CEO',
    Status: 'Active',
};
const LEVEL_ROW = { Level: '1', 'Level Name': 'Board / Top Management' };

describe('normaliseHeader', () => {
    it('keeps letters and digits only', () => {
        expect(normaliseHeader('Level (1 = Highest)')).toBe('level1highest');
        expect(normaliseHeader(' Reports To (Code) ')).toBe('reportstocode');
    });
});

describe('detectSheetKind', () => {
    it('tells the three sheets apart by their headers', () => {
        expect(detectSheetKind(Object.keys(DESIGNATION_ROW))).toBe('designations');
        expect(detectSheetKind(Object.keys(DEPARTMENT_ROW))).toBe('departments');
        expect(detectSheetKind(Object.keys(LEVEL_ROW))).toBe('levels');
        expect(detectSheetKind(['Product', 'Price'])).toBeNull();
    });
});

describe('mapSheetRows', () => {
    it('maps the template headers to import fields', () => {
        expect(mapSheetRows('designations', [DESIGNATION_ROW])).toEqual([{
            code: 'IMP-04',
            name: 'Import & Shipping Executive',
            department_code: 'IMP',
            department_name: 'Import & Sourcing',
            level: '6',
            level_name: 'Executive / Officer',
            reports_to_code: 'IMP-02',
            reports_to_name: 'Sourcing Manager',
            remarks: '',
            status: 'Active',
        }]);
    });

    it('does not let "Reports To (Code)" and "Reports To (Designation)" swap', () => {
        const [row] = mapSheetRows('designations', [DESIGNATION_ROW]);
        expect(row.reports_to_code).toBe('IMP-02');
        expect(row.reports_to_name).toBe('Sourcing Manager');
    });

    it('drops columns the import does not know, and trims values', () => {
        const [row] = mapSheetRows('levels', [{ Level: ' 3 ', 'Level Name': ' Department Head ', Colour: 'red' }]);
        expect(row).toEqual({ level: '3', name: 'Department Head' });
    });

    it('reads a department sheet', () => {
        expect(mapSheetRows('departments', [DEPARTMENT_ROW])[0]).toEqual({
            code: 'IMP',
            name: 'Import & Sourcing',
            description: 'China sourcing, PO/PI/L/C, shipping, customs, licensing',
            reports_to: 'CEO',
            status: 'Active',
        });
    });
});

describe('classifySheets', () => {
    it('sorts tabs into levels, departments and designations whatever they are called', () => {
        const wb = classifySheets([
            { name: 'Sheet A', rows: [DESIGNATION_ROW] },
            { name: 'Depts', rows: [DEPARTMENT_ROW] },
            { name: 'Grades', rows: [LEVEL_ROW] },
            { name: 'Notes', rows: [{ Note: 'hello' }] },
        ]);
        expect(wb.sheets).toEqual({ designations: 'Sheet A', departments: 'Depts', levels: 'Grades' });
        expect(wb.designations).toHaveLength(1);
        expect(wb.departments[0].code).toBe('IMP');
        expect(wb.levels[0].name).toBe('Board / Top Management');
        expect(wb.ignored).toEqual(['Notes']);
    });

    it('keeps the first of two sheets of the same kind', () => {
        const wb = classifySheets([
            { name: 'Designations', rows: [DESIGNATION_ROW] },
            { name: 'Old designations', rows: [DESIGNATION_ROW, DESIGNATION_ROW] },
        ]);
        expect(wb.sheets.designations).toBe('Designations');
        expect(wb.designations).toHaveLength(1);
        expect(wb.ignored).toEqual(['Old designations']);
    });
});

describe('labels', () => {
    it('joins code and name, or shows the name alone', () => {
        expect(codeLabel({ code: 'IMP-04', name: 'Import & Shipping Executive' })).toBe('IMP-04 · Import & Shipping Executive');
        expect(codeLabel({ name: 'Cashier' })).toBe('Cashier');
        expect(codeLabel(null)).toBe('');
    });

    it('names a level with its number', () => {
        expect(levelLabel({ level: 3, name: 'Department Head' })).toBe('Level 3 · Department Head');
        expect(levelLabel({ level: 3, name: 'Department Head' }, 'স্তর')).toBe('স্তর 3 · Department Head');
    });

    it('falls back to the note when a line ends outside the chart', () => {
        expect(reportsToLabel({ reportsTo: { id: 'x', code: 'BRD-01', name: 'Chairman' } })).toBe('BRD-01 · Chairman');
        expect(reportsToLabel({ reportsTo: null, reports_to_note: 'Shareholders' })).toBe('Shareholders');
        expect(reportsToLabel({ reportsTo: null, reports_to_note: null })).toBe('');
    });
});

describe('pickable', () => {
    const items = [
        { id: 'a', is_active: true },
        { id: 'b', is_active: false },
        { id: 'c' },
    ];

    it('offers active records only', () => {
        expect(pickable(items).map((i) => i.id)).toEqual(['a', 'c']);
    });

    it('keeps an inactive record that is already chosen', () => {
        expect(pickable(items, 'b').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('groupByDepartment', () => {
    it('groups designations under their department, with the rest last', () => {
        const imp = { id: 'd-imp', code: 'IMP', name: 'Import & Sourcing' };
        const list: Designation[] = [
            { id: '1', code: 'IMP-01', name: 'Head of Import', department: imp },
            { id: '2', name: 'Floating role', department: null },
            { id: '3', code: 'IMP-02', name: 'Sourcing Manager', department: imp },
        ];
        const groups = groupByDepartment(list, 'No department');
        expect(groups.map((g) => g.label)).toEqual(['IMP · Import & Sourcing', 'No department']);
        expect(groups[0].items.map((d) => d.id)).toEqual(['1', '3']);
    });
});
