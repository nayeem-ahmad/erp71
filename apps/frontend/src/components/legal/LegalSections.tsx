'use client';

import Link from 'next/link';
import type { LegalBlock, LegalInline, LegalSection } from '@/lib/legal/terms-content';
import type { PlanTermsAddendum } from '@/lib/marketing/plan-terms';

/**
 * Renders the Terms of Service from `lib/legal/terms-content`, for both the
 * `/terms` page and the consent box on signup.
 *
 * The two surfaces differ in three ways, which are the three props: how much
 * room the type has (`dense`), which tier addenda to show, and what a
 * same-document link resolves against.
 */
export type LegalSectionsProps = {
    sections: LegalSection[];
    /** Tier addenda to render in the `planAddenda` slot, in order. */
    addenda: PlanTermsAddendum[];
    /** Slug to mark as the one being agreed to, if any. */
    highlightedSlug?: string | null;
    /**
     * Prefix for `sameDocument` links. Empty on `/terms`, where `#plan-terms` is
     * already correct; `/terms` inside the signup box, where a bare fragment
     * would scroll the signup page looking for an anchor it does not have.
     */
    linkBase?: string;
    /** Tighter type and spacing, for the bounded box on signup. */
    dense?: boolean;
    /** Copy for the highlight badge. Omitted on the page, supplied on signup. */
    highlightLabel?: string;
};

function InlineContent({ content, linkBase }: { content: LegalInline[]; linkBase: string }) {
    return (
        <>
            {content.map((node, index) => {
                if (typeof node === 'string') return <span key={index}>{node}</span>;
                if (node.kind === 'strong') return <strong key={index}>{node.text}</strong>;
                if (node.kind === 'email') {
                    return (
                        <a key={index} href={`mailto:${node.address}`} className="text-blue-600 hover:underline">
                            {node.address}
                        </a>
                    );
                }
                const href = node.sameDocument ? `${linkBase}${node.href}` : node.href;
                return (
                    <Link key={index} href={href} className="text-blue-600 hover:underline font-medium">
                        {node.text}
                    </Link>
                );
            })}
        </>
    );
}

function Block({ block, linkBase, dense }: { block: LegalBlock; linkBase: string; dense: boolean }) {
    if (block.kind === 'p') {
        return (
            <p className={dense ? 'mb-2' : 'mb-4 last:mb-0'}>
                <InlineContent content={block.content} linkBase={linkBase} />
            </p>
        );
    }

    if (block.kind === 'ul') {
        return (
            <ul className={`list-disc ps-6 ${dense ? 'space-y-1 text-xs' : 'space-y-2 text-sm'}`}>
                {block.items.map((item, index) => (
                    <li key={index}>
                        <InlineContent content={item} linkBase={linkBase} />
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <div className={`bg-gray-50 rounded-xl p-4 space-y-1 ${dense ? 'mt-2 text-xs' : 'mt-3 text-sm'}`}>
            {block.lines.map((line, index) => (
                <p key={index}>
                    <InlineContent content={line} linkBase={linkBase} />
                </p>
            ))}
        </div>
    );
}

/**
 * The tier-specific section. Which addenda arrive is the caller's decision:
 * `/terms` passes all of them, because the whole document is the agreement and
 * hiding the tiers a reader did not arrive on would misrepresent it; the signup
 * box passes only the tier being bought, because that is the one whose terms
 * form part of *this* purchase.
 */
function PlanAddenda({
    addenda,
    highlightedSlug,
    highlightLabel,
    dense,
}: {
    addenda: PlanTermsAddendum[];
    highlightedSlug?: string | null;
    highlightLabel?: string;
    dense: boolean;
}) {
    return (
        <div className={dense ? 'space-y-3' : 'space-y-6'}>
            {addenda.map((addendum) => {
                const highlighted = addendum.slug === highlightedSlug;
                return (
                    <div
                        key={addendum.slug}
                        id={`plan-terms-${addendum.slug}`}
                        className={`scroll-mt-28 rounded-xl border ${dense ? 'p-3' : 'p-4'} ${highlighted ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'
                            }`}
                    >
                        <div className="flex flex-wrap items-baseline gap-2">
                            <h3 className={`font-bold text-gray-900 ${dense ? 'text-sm' : 'text-base'}`}>
                                {addendum.name}
                            </h3>
                            {highlighted && highlightLabel && (
                                <span className="text-xs font-medium text-blue-600">{highlightLabel}</span>
                            )}
                        </div>
                        <p className={`mt-1 text-gray-500 ${dense ? 'text-xs' : 'text-sm'}`}>{addendum.summary}</p>
                        <ul className={`mt-3 list-disc ps-6 ${dense ? 'space-y-1 text-xs' : 'space-y-2 text-sm'}`}>
                            {addendum.clauses.map((clause) => (
                                <li key={clause.title}>
                                    <strong>{clause.title}.</strong> {clause.body}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

export default function LegalSections({
    sections,
    addenda,
    highlightedSlug,
    linkBase = '',
    dense = false,
    highlightLabel,
}: LegalSectionsProps) {
    return (
        <div className={dense ? 'space-y-4 text-xs text-gray-600 leading-relaxed' : 'space-y-10 text-gray-700 leading-relaxed'}>
            {sections.map((section, index) => {
                // Numbering is positional so the generated addenda section can
                // never fall out of step with the prose's cross-references.
                const number = index + 1;

                if (section.kind === 'planAddenda') {
                    return (
                        <section key="plan-terms" id="plan-terms" className="scroll-mt-28">
                            <h2 className={`font-bold text-gray-900 mb-3 ${dense ? 'text-sm' : 'text-xl'}`}>
                                {number}. Plan-Specific Terms
                            </h2>
                            <p className={dense ? 'mb-2' : 'mb-3'}>
                                Sections 1&ndash;{number - 1} apply to every subscriber. The terms below apply in
                                addition, according to the tier your workspace is on, and are part of what you accept
                                when you create or change a subscription. Where a plan-specific term conflicts with
                                Sections 1&ndash;{number - 1}, the plan-specific term governs for that tier.
                            </p>
                            <p className={dense ? 'mb-3' : 'mb-6'}>
                                Prices, capacity limits and inclusions are not restated here — they are published on
                                the{' '}
                                <Link href="/pricing" className="text-blue-600 hover:underline font-medium">
                                    pricing page
                                </Link>
                                {' '}for the reason given in Section 4.
                            </p>
                            <PlanAddenda
                                addenda={addenda}
                                highlightedSlug={highlightedSlug}
                                highlightLabel={highlightLabel}
                                dense={dense}
                            />
                        </section>
                    );
                }

                return (
                    <section key={section.heading}>
                        <h2 className={`font-bold text-gray-900 mb-3 ${dense ? 'text-sm' : 'text-xl'}`}>
                            {number}. {section.heading}
                        </h2>
                        {section.blocks.map((block, blockIndex) => (
                            <Block key={blockIndex} block={block} linkBase={linkBase} dense={dense} />
                        ))}
                    </section>
                );
            })}
        </div>
    );
}
