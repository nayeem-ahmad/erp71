/**
 * COLORFUL style: one hue per sidebar module, so a module is recognisable at
 * a glance. Keys are the nav module keys from `nav-resolver`; anything not
 * listed stays grey.
 */
const MODULE_TONE: Record<string, string> = {
    dashboard: 'text-blue-600',
    sales: 'text-emerald-600',
    storefront: 'text-cyan-600',
    purchase: 'text-orange-500',
    imports: 'text-amber-600',
    inventory: 'text-violet-600',
    manufacturing: 'text-lime-600',
    accounting: 'text-sky-600',
    expenses: 'text-red-500',
    crm: 'text-pink-600',
    hr: 'text-teal-600',
    projects: 'text-indigo-500',
    chat: 'text-fuchsia-600',
    reports: 'text-purple-600',
    admin: 'text-slate-600',
    tools: 'text-indigo-500',
};

// The same hues a step lighter, so they read on the navy sidebar.
const MODULE_TONE_ON_NAVY: Record<string, string> = {
    dashboard: 'text-blue-400',
    sales: 'text-emerald-400',
    storefront: 'text-cyan-400',
    purchase: 'text-orange-400',
    imports: 'text-amber-400',
    inventory: 'text-violet-400',
    manufacturing: 'text-lime-400',
    accounting: 'text-sky-400',
    expenses: 'text-red-400',
    crm: 'text-pink-400',
    hr: 'text-teal-400',
    projects: 'text-indigo-300',
    chat: 'text-fuchsia-400',
    reports: 'text-purple-400',
    admin: 'text-slate-300',
    tools: 'text-indigo-300',
};

export function moduleIconTone(key: string, onNavy = false): string {
    return onNavy ? (MODULE_TONE_ON_NAVY[key] ?? 'text-slate-400') : (MODULE_TONE[key] ?? 'text-gray-500');
}
