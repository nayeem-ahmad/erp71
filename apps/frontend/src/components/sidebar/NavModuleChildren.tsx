'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { ResolvedNavChild } from '@/lib/nav-resolver';
import { isNavSubgroup } from '@/lib/sidebar-modules';
import NavCountBadge from './NavCountBadge';

export interface NavModuleChildrenProps {
    moduleKey: string;
    items: ResolvedNavChild[];
    openGroups: Record<string, boolean>;
    onToggleGroup: (key: string) => void;
    isActive: (href: string, exact?: boolean) => boolean;
    /** While searching every subgroup is open and the toggles are inert. */
    isSearching: boolean;
    compactNav?: boolean;
    /** The count a link carries (the voucher approval queue), 0 for none. */
    badgeFor: (href: string) => number;
    badgeTitle: string;
    /**
     * Links sit directly under the app's heading (the app panel) rather than
     * under a module header (the classic tree), so they indent one step less.
     */
    flat?: boolean;
}

/**
 * A module's links and subgroups, as both the classic sidebar and the app
 * panel draw them — one markup, so the two shells cannot drift apart.
 */
export default function NavModuleChildren({
    moduleKey,
    items,
    openGroups,
    onToggleGroup,
    isActive,
    isSearching,
    compactNav = false,
    badgeFor,
    badgeTitle,
    flat = false,
}: NavModuleChildrenProps) {
    const navText = compactNav ? 'text-[13px]' : 'text-sm';
    const navLabelCls = `${navText} font-normal tracking-tight whitespace-nowrap`;
    const indent = flat ? '' : 'ms-4';
    const nestedIndent = flat ? 'ms-4' : 'ms-8';

    const childLinkCls = (active: boolean, nested = false) =>
        `flex items-center rounded-lg transition-all duration-150 group space-x-2.5 rtl:space-x-reverse px-2.5 ${compactNav ? 'py-1' : 'py-1.5'} ${navText} ${
            nested ? nestedIndent : indent
        } ${
            active
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
        }`;

    const subgroupBtnCls = (active: boolean) =>
        `flex items-center w-full rounded-lg transition-all duration-150 space-x-2.5 rtl:space-x-reverse px-2.5 ${compactNav ? 'py-1' : 'py-1.5'} ${indent} ${navText} ${
            active
                ? 'text-blue-700 bg-blue-50/70'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`;

    return (
        <div className="mt-0.5 space-y-0.5">
            {items.map((child) => {
                if (isNavSubgroup(child)) {
                    const subgroupKey = `${moduleKey}:${child.key}`;
                    const subgroupOpen = isSearching || (openGroups[subgroupKey] ?? false);
                    const SubgroupIcon = child.icon;
                    const subgroupActive = child.children.some((link) => isActive(link.href, link.exact));

                    return (
                        <div key={subgroupKey}>
                            <button
                                type="button"
                                onClick={() => onToggleGroup(subgroupKey)}
                                disabled={isSearching}
                                aria-expanded={subgroupOpen}
                                className={`${subgroupBtnCls(subgroupActive)}${isSearching ? ' cursor-default' : ''}`}
                            >
                                <SubgroupIcon className={`flex-shrink-0 w-4 h-4 ${subgroupActive ? 'text-blue-600' : ''}`} />
                                <span className={navLabelCls}>{child.label}</span>
                                <ChevronDown
                                    className={`ms-auto w-3.5 h-3.5 transition-transform duration-200 ${
                                        subgroupOpen ? 'rotate-180' : ''
                                    } ${subgroupActive ? 'text-blue-400' : 'text-gray-300'}`}
                                />
                            </button>
                            {subgroupOpen && (
                                <div className="mt-0.5 space-y-0.5">
                                    {child.children.map(({ href, icon: LinkIcon, label, exact }) => {
                                        const active = isActive(href, exact);
                                        return (
                                            <Link key={href} href={href} className={childLinkCls(active, true)}>
                                                <LinkIcon className={`flex-shrink-0 w-3.5 h-3.5 ${active ? 'text-blue-600' : ''}`} />
                                                <span className={navLabelCls}>{label}</span>
                                                <NavCountBadge count={badgeFor(href)} title={badgeTitle} />
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                }

                const { href, icon: ChildIcon, label, section, exact } = child;
                if (section) {
                    return (
                        <div key={href} className={`flex items-center ${indent} px-3 pt-3 pb-1`}>
                            <ChildIcon className="flex-shrink-0 w-3.5 h-3.5 text-gray-300" />
                            <span className="ms-2 text-[10px] font-black uppercase tracking-widest text-gray-300">{label}</span>
                        </div>
                    );
                }
                const active = isActive(href, exact);
                return (
                    <Link key={href} href={href} className={childLinkCls(active)}>
                        <ChildIcon className={`flex-shrink-0 w-4 h-4 ${active ? 'text-blue-600' : ''}`} />
                        <span className={navLabelCls}>{label}</span>
                        <NavCountBadge count={badgeFor(href)} title={badgeTitle} />
                    </Link>
                );
            })}
        </div>
    );
}
