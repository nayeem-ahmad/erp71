#!/usr/bin/env node
/**
 * Translation progress report for the frontend message catalogs.
 *
 * `catalog.test.ts` already proves every locale has the same *keys* as English.
 * What it cannot see is a key whose value is still the English string, which is
 * exactly the state a freshly scaffolded locale is in. This loads each catalog
 * for real (TypeScript transpiled in-memory, no build step) and reports, per
 * locale and per namespace, how many leaf strings still match English.
 *
 * It also flags placeholder drift ({name}, {count}, …) — the failure mode that
 * silently renders "Hello {nom}" to a user — and array-length drift, which the
 * key-parity test cannot see because it treats an array as a single leaf.
 *
 *   node scripts/i18n-report.js             # every locale, summary
 *   node scripts/i18n-report.js de fr       # only these locales
 *   node scripts/i18n-report.js de --details  # list each untranslated key path
 */

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const MESSAGES_DIR = path.join(
    __dirname,
    '..',
    'apps',
    'frontend',
    'src',
    'lib',
    'localization',
    'messages',
);
const BASE_LOCALE = 'en';

/**
 * Minimal CommonJS loader for the catalog files: transpile away the types, then
 * evaluate with a `require` that only resolves siblings inside the messages
 * tree. Catalogs import nothing else, so this needs no module resolution.
 */
const moduleCache = new Map();

function loadCatalogModule(filePath) {
    const resolved = filePath.endsWith('.ts') ? filePath : `${filePath}.ts`;
    if (moduleCache.has(resolved)) return moduleCache.get(resolved);

    const source = fs.readFileSync(resolved, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: resolved,
    });

    const moduleExports = {};
    moduleCache.set(resolved, moduleExports);

    const localRequire = (specifier) =>
        loadCatalogModule(path.resolve(path.dirname(resolved), specifier));

    const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText);
    const moduleObject = { exports: moduleExports };
    factory(moduleExports, localRequire, moduleObject, resolved, path.dirname(resolved));

    moduleCache.set(resolved, moduleObject.exports);
    return moduleObject.exports;
}

/** Flattens a catalog namespace to `key.path -> string`, expanding arrays. */
function flatten(value, prefix, sink) {
    if (typeof value === 'string') {
        sink.set(prefix, value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, sink));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            flatten(nested, prefix ? `${prefix}.${key}` : key, sink);
        }
    }
}

function loadNamespace(locale, file) {
    const exported = loadCatalogModule(path.join(MESSAGES_DIR, locale, file));
    const sink = new Map();
    // Each namespace file has exactly one export, whatever it is named.
    for (const value of Object.values(exported)) flatten(value, '', sink);
    return sink;
}

function placeholders(value) {
    return (value.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join(',');
}

/** Values that are legitimately identical across languages. */
function isLanguageNeutral(value) {
    const trimmed = value.trim();
    if (trimmed === '') return true;
    // No lowercase run of 3+ letters: symbols, numbers, codes, CAPS enums, emoji.
    if (!/[a-z]{3}/.test(trimmed)) return true;
    if (/^https?:\/\//.test(trimmed)) return true;
    if (/^[\w.+-]+@[\w.-]+$/.test(trimmed)) return true;
    if (/^\/[\w/-]*$/.test(trimmed)) return true;
    return false;
}

/**
 * The namespaces a locale actually ships, read from the English barrel rather
 * than the directory listing so stray scratch files in the folder are ignored.
 */
function namespaceFiles() {
    const barrel = fs.readFileSync(path.join(MESSAGES_DIR, BASE_LOCALE, 'index.ts'), 'utf8');
    const specifiers = [...barrel.matchAll(/from\s+'\.\/([\w-]+)'/g)].map((m) => `${m[1]}.ts`);
    return [...new Set(specifiers)].sort();
}

function main() {
    const args = process.argv.slice(2);
    const details = args.includes('--details');
    const requested = args.filter((a) => !a.startsWith('--'));

    const locales = fs
        .readdirSync(MESSAGES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== BASE_LOCALE)
        .map((d) => d.name)
        .filter((l) => requested.length === 0 || requested.includes(l))
        .sort();

    const files = namespaceFiles();
    let exitCode = 0;

    for (const locale of locales) {
        const rows = [];
        let total = 0;
        let englishLeft = 0;
        const problems = [];

        for (const file of files) {
            if (!fs.existsSync(path.join(MESSAGES_DIR, locale, file))) {
                rows.push({ file, missing: true });
                exitCode = 1;
                continue;
            }

            const base = loadNamespace(BASE_LOCALE, file);
            const target = loadNamespace(locale, file);

            let same = 0;
            let translatable = 0;

            for (const [key, enValue] of base) {
                if (!target.has(key)) {
                    problems.push(`${file} ${key} — missing in ${locale}`);
                    continue;
                }
                const trValue = target.get(key);

                if (placeholders(enValue) !== placeholders(trValue)) {
                    problems.push(
                        `${file} ${key} — placeholders en{${placeholders(enValue)}} vs ${locale}{${placeholders(trValue)}}`,
                    );
                }

                if (isLanguageNeutral(enValue)) continue;
                translatable += 1;
                if (enValue === trValue) {
                    same += 1;
                    if (details) {
                        console.log(`  ${file} ${key} = ${JSON.stringify(enValue.slice(0, 70))}`);
                    }
                }
            }

            for (const key of target.keys()) {
                if (!base.has(key)) problems.push(`${file} ${key} — extra key in ${locale}`);
            }

            rows.push({ file, translatable, same });
            total += translatable;
            englishLeft += same;
        }

        const done = total - englishLeft;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        console.log(`\n${locale.toUpperCase()}  ${done}/${total} translated (${pct}%)`);

        for (const row of rows) {
            if (row.missing) {
                console.log(`  ${row.file.padEnd(22)} MISSING`);
            } else if (row.same > 0) {
                console.log(
                    `  ${row.file.padEnd(22)} ${row.translatable - row.same}/${row.translatable}  (${row.same} still English)`,
                );
            }
        }

        if (problems.length > 0) {
            exitCode = 1;
            console.log(`  !! ${problems.length} structural problem(s):`);
            for (const p of problems.slice(0, 25)) console.log(`     ${p}`);
            if (problems.length > 25) console.log(`     … ${problems.length - 25} more`);
        }
    }

    console.log('');
    process.exit(exitCode);
}

main();
