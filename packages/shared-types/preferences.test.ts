import { DEFAULT_INVOICE_PRINT_PREFS } from './invoice-print';
import { DEFAULT_TABLE_VIEW } from './table-view';
import {
  DEFAULT_ALERT_PREFS,
  DEFAULT_SECTION_VALUES,
  PREFERENCE_SECTIONS,
  normalizeMemberPreferences,
  normalizeProfilePrefs,
  normalizeSectionPartial,
  resolvePreferences,
  type PreferenceProfilePrefs,
  type SectionPartials,
} from './preferences';

// Layer builders, so a test states only the fields a profile or member sets.
const sections = (value: SectionPartials) => value;
const profileOf = (value: SectionPartials): PreferenceProfilePrefs => ({ version: 1, sections: value });

describe('built-in values', () => {
  it('has the documented alert defaults', () => {
    expect(DEFAULT_ALERT_PREFS).toEqual({ mutedTypes: [], quiet: { enabled: true, from: 1320, to: 480 } });
  });

  it('has a default for every section', () => {
    expect(Object.keys(DEFAULT_SECTION_VALUES).sort()).toEqual([...PREFERENCE_SECTIONS].sort());
  });
});

describe('resolvePreferences', () => {
  it('reads nothing saved as the built-in values, every section from the default', () => {
    const out = resolvePreferences({});
    for (const key of PREFERENCE_SECTIONS) expect(out[key].source).toBe('default');
    expect(out.invoicePrint.value).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
    expect(out.alerts.value).toEqual(DEFAULT_ALERT_PREFS);
    expect(out.device.value).toEqual({});
    expect(out.tableView.value).toEqual({ global: DEFAULT_TABLE_VIEW, tables: {} });
    expect(out.tableColumns.value).toEqual({});
    expect(out.sidebar.value).toEqual({});
  });

  it('does not hand out the shared defaults to be mutated', () => {
    const out = resolvePreferences({});
    out.alerts.value.mutedTypes.push('x');
    out.alerts.value.quiet.from = 1;
    out.tableView.value.global.density = 'cozy';
    expect(DEFAULT_ALERT_PREFS).toEqual({ mutedTypes: [], quiet: { enabled: true, from: 1320, to: 480 } });
    expect(DEFAULT_TABLE_VIEW.density).toBe('standard');
    expect(resolvePreferences({}).alerts.value).toEqual(DEFAULT_ALERT_PREFS);
  });

  it('lets the member override the profile field by field', () => {
    const out = resolvePreferences({
      profile: profileOf({ invoicePrint: { table_style: 'grid', layout: 'detailed' } }),
      member: sections({ invoicePrint: { table_style: 'striped' } }),
    });
    expect(out.invoicePrint.value.table_style).toBe('striped');
    expect(out.invoicePrint.value.layout).toBe('detailed');
    expect(out.invoicePrint.value.padding).toBe(DEFAULT_INVOICE_PRINT_PREFS.padding);
    expect(out.invoicePrint.source).toBe('member');
  });

  it('reports the profile as the source when only the profile set the section', () => {
    const out = resolvePreferences({ profile: profileOf({ invoicePrint: { layout: 'detailed' } }) });
    expect(out.invoicePrint.source).toBe('profile');
    expect(out.alerts.source).toBe('default');
  });

  it('keeps a member footer_text of null over a profile footer', () => {
    const out = resolvePreferences({
      profile: profileOf({ invoicePrint: { footer_text: 'Thanks' } }),
      member: sections({ invoicePrint: { footer_text: null } }),
    });
    expect(out.invoicePrint.value.footer_text).toBeNull();
  });

  it('replaces a list entry whole rather than merging it', () => {
    const out = resolvePreferences({
      profile: profileOf({ tableColumns: { a: { hidden: ['x'], pageSize: 50 }, b: { hidden: ['z'] } } }),
      member: sections({ tableColumns: { a: { order: ['y'] } } }),
    });
    expect(out.tableColumns.value).toEqual({ a: { order: ['y'] }, b: { hidden: ['z'] } });
    expect(out.tableColumns.source).toBe('member');
  });

  it('merges the global list view field by field and replaces per-list entries whole', () => {
    const out = resolvePreferences({
      profile: profileOf({
        tableView: {
          global: { density: 'compact' },
          tables: { sales: { density: 'cozy', fontSize: 'lg' } },
        },
      }),
      member: sections({
        tableView: { global: { striped: false }, tables: { sales: { fitWidth: true } } },
      }),
    });
    expect(out.tableView.value.global).toEqual({ ...DEFAULT_TABLE_VIEW, density: 'compact', striped: false });
    // The member's entry replaces the profile's whole (no cozy / lg), then fills from the resolved global.
    expect(out.tableView.value.tables).toEqual({
      sales: { ...DEFAULT_TABLE_VIEW, density: 'compact', striped: false, fitWidth: true },
    });
  });

  it('fills a per-list entry from the resolved global so every entry is complete', () => {
    const out = resolvePreferences({
      profile: profileOf({ tableView: { global: { density: 'compact' } } }),
      member: sections({ tableView: { tables: { sales: { fitWidth: true } } } }),
    });
    expect(out.tableView.value.tables.sales).toEqual({ ...DEFAULT_TABLE_VIEW, density: 'compact', fitWidth: true });
  });

  it('replaces the sidebar group list whole', () => {
    const out = resolvePreferences({
      profile: profileOf({ sidebar: { appShellOpenGroups: ['sales', 'stock'] } }),
      member: sections({ sidebar: { appShellOpenGroups: ['crm'] } }),
    });
    expect(out.sidebar.value).toEqual({ appShellOpenGroups: ['crm'] });
  });

  it('keeps a member who closed every group over the profile', () => {
    const out = resolvePreferences({
      profile: profileOf({ sidebar: { appShellOpenGroups: ['sales'] } }),
      member: sections({ sidebar: { appShellOpenGroups: [] } }),
    });
    expect(out.sidebar.value).toEqual({ appShellOpenGroups: [] });
    expect(out.sidebar.source).toBe('member');
  });

  describe('legacy browser layer', () => {
    it('sits above the profile and below the member', () => {
      const profile = profileOf({ tableColumns: { a: { hidden: ['p'] } } });
      const legacy = { tableColumns: { a: { hidden: ['b'] } } };

      const fromBrowser = resolvePreferences({ profile, legacy });
      expect(fromBrowser.tableColumns.value).toEqual({ a: { hidden: ['b'] } });
      expect(fromBrowser.tableColumns.source).toBe('browser');

      const fromMember = resolvePreferences({
        profile,
        legacy,
        member: sections({ tableColumns: { a: { hidden: ['m'] } } }),
      });
      expect(fromMember.tableColumns.value).toEqual({ a: { hidden: ['m'] } });
      expect(fromMember.tableColumns.source).toBe('member');
    });

    it('ignores a legacy value for a section that was never browser-held', () => {
      const out = resolvePreferences({ legacy: { invoicePrint: { layout: 'detailed' }, device: { paperSize: 'A5' } } as never });
      expect(out.invoicePrint.value).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
      expect(out.invoicePrint.source).toBe('default');
      expect(out.device.source).toBe('default');
    });

    it('cleans junk in the legacy layer instead of throwing', () => {
      const out = resolvePreferences({ legacy: { tableView: 'garbage', sidebar: { appShellOpenGroups: 7 } } });
      expect(out.tableView.source).toBe('default');
      expect(out.sidebar.source).toBe('default');
    });
  });

  describe('device', () => {
    it('holds only the fields the profile sets', () => {
      const out = resolvePreferences({ profile: profileOf({ device: { paperSize: 'Thermal80' } }) });
      expect(out.device.value).toEqual({ paperSize: 'Thermal80' });
      expect(out.device.source).toBe('profile');
    });

    it('ignores a device answer from the member layer', () => {
      const out = resolvePreferences({ member: sections({ device: { paperSize: 'A5' } }) });
      expect(out.device.value).toEqual({});
      expect(out.device.source).toBe('default');
    });
  });

  describe('alerts', () => {
    it('merges quiet hours field by field', () => {
      const out = resolvePreferences({ profile: profileOf({ alerts: { quiet: { from: 1200 } } }) });
      expect(out.alerts.value.quiet).toEqual({ enabled: true, from: 1200, to: 480 });
      expect(out.alerts.value.mutedTypes).toEqual([]);
      expect(out.alerts.source).toBe('profile');
    });

    it('lets a member change one quiet field over the profile', () => {
      const out = resolvePreferences({
        profile: profileOf({ alerts: { mutedTypes: ['a'], quiet: { from: 1200, to: 400 } } }),
        member: sections({ alerts: { quiet: { enabled: false } } }),
      });
      expect(out.alerts.value).toEqual({ mutedTypes: ['a'], quiet: { enabled: false, from: 1200, to: 400 } });
      expect(out.alerts.source).toBe('member');
    });

    it('replaces mutedTypes whole', () => {
      const out = resolvePreferences({
        profile: profileOf({ alerts: { mutedTypes: ['a', 'b'] } }),
        member: sections({ alerts: { mutedTypes: ['c'] } }),
      });
      expect(out.alerts.value.mutedTypes).toEqual(['c']);
    });
  });
});

describe('normalizeSectionPartial', () => {
  const ids = (n: number, prefix = 'id') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('drops list ids that fail the pattern', () => {
    const out = normalizeSectionPartial('tableColumns', { 'good.id': {}, '-bad': {}, 'has space': {}, '': {} });
    expect(Object.keys(out)).toEqual(['good.id']);
  });

  it('still drops a list id with a space, even with readable columns', () => {
    const out = normalizeSectionPartial('tableColumns', { 'sales list': { hidden: ['Customer Name'] } });
    expect(out).toEqual({});
  });

  it('column ids may contain spaces and capitals', () => {
    // TanStack takes a column's id from its string header when it has neither `id` nor `accessorKey`.
    const out = normalizeSectionPartial('tableColumns', {
      a: { hidden: ['Customer Name', 'createdAt'], order: ['Customer Name', 'createdAt', 'Due (৳)'] },
    });
    expect(out.a.hidden).toEqual(['Customer Name', 'createdAt']);
    expect(out.a.order).toEqual(['Customer Name', 'createdAt', 'Due (৳)']);
  });

  it('a column id with a control character or empty/whitespace-only is dropped', () => {
    const out = normalizeSectionPartial('tableColumns', {
      a: { hidden: ['ok', '', '   ', 'tab\there', 'line\nbreak', 'nul\u0000', 'del\u007f', '\u001f'] },
    });
    expect(out.a.hidden).toEqual(['ok']);
  });

  it('an 81-char column id is dropped', () => {
    const out = normalizeSectionPartial('tableColumns', { a: { hidden: ['x'.repeat(80), 'y'.repeat(81)] } });
    expect(out.a.hidden).toEqual(['x'.repeat(80)]);
  });

  it('sidebar group ids keep the strict pattern', () => {
    const out = normalizeSectionPartial('sidebar', { appShellOpenGroups: ['sales', 'Sales Group', '__proto__'] });
    expect(out.appShellOpenGroups).toEqual(['sales']);
  });

  it('keeps the first 300 lists and drops the 301st', () => {
    const raw = Object.fromEntries(ids(301, 'list').map((id) => [id, { hidden: ['c'] }]));
    const out = normalizeSectionPartial('tableColumns', raw);
    expect(Object.keys(out)).toHaveLength(300);
    expect(out).not.toHaveProperty('list300');
  });

  it('keeps the first 100 distinct column ids and drops what is not one', () => {
    const out = normalizeSectionPartial('tableColumns', {
      a: { hidden: ['c0', ...ids(101, 'c')], order: ['ok', 'no good', 'ok', 5, null] },
    });
    expect(out.a.hidden).toHaveLength(100);
    expect(out.a.hidden).not.toContain('c100');
    expect(out.a.order).toEqual(['ok', 'no good']);
  });

  it('drops a page size outside 1 to 500 or not a whole number', () => {
    const out = normalizeSectionPartial('tableColumns', {
      zero: { pageSize: 0 },
      over: { pageSize: 501 },
      frac: { pageSize: 10.5 },
      text: { pageSize: '50' },
      ok: { pageSize: 500 },
      low: { pageSize: 1 },
    });
    expect(out.zero).toEqual({});
    expect(out.over).toEqual({});
    expect(out.frac).toEqual({});
    expect(out.text).toEqual({});
    expect(out.ok).toEqual({ pageSize: 500 });
    expect(out.low).toEqual({ pageSize: 1 });
  });

  it('keeps the first 50 sidebar group ids', () => {
    const out = normalizeSectionPartial('sidebar', { appShellOpenGroups: [...ids(51, 'g'), '*bad'] });
    expect(out.appShellOpenGroups).toHaveLength(50);
    expect(out.appShellOpenGroups).not.toContain('g50');
  });

  it('drops a sidebar group list that is not a list', () => {
    expect(normalizeSectionPartial('sidebar', { appShellOpenGroups: 'sales' })).toEqual({});
  });

  it('accepts a partial quiet object and drops quiet minutes outside 0 to 1439', () => {
    expect(normalizeSectionPartial('alerts', { quiet: { from: 1200 } })).toEqual({ quiet: { from: 1200 } });
    expect(
      normalizeSectionPartial('alerts', { quiet: { enabled: false, from: 1440, to: -1 } }),
    ).toEqual({ quiet: { enabled: false } });
    expect(normalizeSectionPartial('alerts', { quiet: { from: 10.5, to: '5' } })).toEqual({});
    expect(normalizeSectionPartial('alerts', { quiet: { from: 0, to: 1439 } })).toEqual({
      quiet: { from: 0, to: 1439 },
    });
  });

  it('keeps muted types that are strings', () => {
    expect(normalizeSectionPartial('alerts', { mutedTypes: ['low_stock', 3, ''] })).toEqual({
      mutedTypes: ['low_stock'],
    });
  });

  it('keeps only valid device fields', () => {
    expect(
      normalizeSectionPartial('device', {
        paperSize: 'Thermal58',
        printDensity: 'tiny',
        printTypeScale: 'larger',
        skipPreview: true,
        sidebarCollapsed: 'yes',
        extra: 1,
      }),
    ).toEqual({ paperSize: 'Thermal58', printTypeScale: 'larger', skipPreview: true });
  });

  it('keeps valid list view settings and per-list overrides', () => {
    expect(
      normalizeSectionPartial('tableView', {
        global: { density: 'cozy', fontSize: 'huge' },
        tables: { sales: { striped: false }, '-bad': { striped: true } },
      }),
    ).toEqual({ global: { density: 'cozy' }, tables: { sales: { striped: false } } });
  });

  it('reads garbage as no answers', () => {
    for (const key of PREFERENCE_SECTIONS) {
      expect(normalizeSectionPartial(key, 'garbage')).toEqual({});
      expect(normalizeSectionPartial(key, null)).toEqual({});
    }
  });
});

describe('normalizeProfilePrefs', () => {
  it('reads garbage as an empty profile', () => {
    expect(normalizeProfilePrefs('garbage')).toEqual({ version: 1, sections: {} });
    expect(normalizeProfilePrefs(null)).toEqual({ version: 1, sections: {} });
    expect(normalizeProfilePrefs({ sections: 'x' })).toEqual({ version: 1, sections: {} });
  });

  it('drops an unknown section key and sections with nothing valid', () => {
    expect(
      normalizeProfilePrefs({
        version: 1,
        sections: { bogus: { a: 1 }, device: { paperSize: 'A4' }, alerts: { mutedTypes: 'x' } },
      }),
    ).toEqual({ version: 1, sections: { device: { paperSize: 'A4' } } });
  });

  it('is stable when applied twice', () => {
    const once = normalizeProfilePrefs({
      sections: {
        invoicePrint: { layout: 'detailed', footer_text: null },
        alerts: { quiet: { from: 1200 } },
        tableColumns: { a: { hidden: ['x'], pageSize: 20 } },
      },
    });
    expect(normalizeProfilePrefs(once)).toEqual(once);
  });
});

describe('normalizeMemberPreferences', () => {
  it('reads garbage as an empty member record', () => {
    expect(normalizeMemberPreferences('garbage')).toEqual({ version: 1 });
    expect(normalizeMemberPreferences(undefined)).toEqual({ version: 1 });
  });

  it('keeps only the browser-era person sections that carry a valid answer', () => {
    expect(
      normalizeMemberPreferences({
        version: 1,
        tableView: { global: { density: 'compact' } },
        tableColumns: { a: { hidden: ['x'] } },
        sidebar: { appShellOpenGroups: ['sales'] },
        alerts: { mutedTypes: ['a'] },
        device: { paperSize: 'A4' },
      }),
    ).toEqual({
      version: 1,
      tableView: { global: { density: 'compact' } },
      tableColumns: { a: { hidden: ['x'] } },
      sidebar: { appShellOpenGroups: ['sales'] },
    });
  });
});
