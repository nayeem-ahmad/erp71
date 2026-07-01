#!/usr/bin/env node
/**
 * Applies compact UI class replacements to module pages that still use the
 * spacious layout patterns. Skips accounting (already migrated) and POS.
 */
import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve('src/app/(app)');

const SKIP_PREFIXES = [
    'accounting/',
    'sales/pos/',
    'dashboard/onboarding/',
];

const REPLACEMENTS = [
    [
        'overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900',
        'overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]',
    ],
    ['max-w-[1200px] mx-auto space-y-8', 'max-w-[1200px] mx-auto space-y-4'],
    ['w-full space-y-6', 'w-full space-y-4'],
    ['text-2xl font-black tracking-tight', 'text-lg font-bold tracking-tight text-gray-950'],
    ['text-3xl font-black tracking-tight', 'text-lg font-bold tracking-tight text-gray-950'],
    [
        'text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5',
        'text-xs text-gray-500 mt-0.5',
    ],
    [
        'text-xs font-black uppercase tracking-[0.24em] text-gray-400',
        'text-xs font-medium text-gray-500',
    ],
    ['rounded-2xl border border-gray-200 bg-white p-5', 'rounded-lg border border-gray-200 bg-white p-3 md:p-4'],
    ['rounded-3xl border border-gray-200 bg-white p-5', 'rounded-lg border border-gray-200 bg-white p-3'],
    ['px-4 py-2.5 rounded-xl font-bold text-sm', 'px-3 py-1.5 rounded-lg text-xs font-semibold'],
    ['text-[10px] font-black uppercase tracking-widest text-gray-400', 'text-xs font-medium text-gray-500'],
];

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else if (entry.name.endsWith('.tsx')) files.push(full);
    }
    return files;
}

function relativeAppPath(file) {
    return path.relative(APP_DIR, file).replaceAll('\\', '/');
}

function shouldSkip(rel) {
    return SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

let changed = 0;

for (const file of walk(APP_DIR)) {
    const rel = relativeAppPath(file);
    if (shouldSkip(rel)) continue;

    const original = fs.readFileSync(file, 'utf8');
    let next = original;
    for (const [from, to] of REPLACEMENTS) {
        next = next.split(from).join(to);
    }

    if (next !== original) {
        fs.writeFileSync(file, next);
        changed += 1;
        console.log(`updated: ${rel}`);
    }
}

console.log(`\nDone — ${changed} file(s) updated.`);