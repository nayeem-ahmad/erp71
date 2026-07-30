import { StorePermission } from '@erp71/shared-types';
import { helpSectionTitles, searchHelp } from '../help-content';
import type { ChatTool } from './types';

export const HELP_TOOLS: ChatTool[] = [
    {
        name: 'search_help',
        // Product documentation, not tenant data — everyone who can reach the
        // chatbot may ask how the app works. Uses the same weakest permission as
        // the other always-available tools so it is never filtered away.
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        // No `modules`: the Help Center documents every module (and says which are
        // Premium), so a question about a feature the plan lacks still gets a
        // truthful answer rather than silence.
        description:
            'How the app itself works: how to do something, where a feature lives, what a feature does, or what a ' +
            'setting means — for the ERP71 product, not this business\'s data. Call this for "how do I…", "where is…", ' +
            '"what does X do", "can the app…" and setup/plan questions. It returns the matching Help Center FAQ ' +
            'entries; answer from them, and do NOT answer product how-to from your own memory — the app changes and ' +
            'this is the current documentation.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What the user wants to do or understand, e.g. "record a customer return" or "offline POS".',
                },
            },
            required: ['query'],
        },
        handler: async (_ctx, args) => {
            const query = String(args.query ?? '').trim();
            const matches = searchHelp(query);
            if (matches.length === 0) {
                return {
                    matchCount: 0,
                    sections: helpSectionTitles(),
                    note:
                        'No Help Center FAQ matched. Do not invent product behaviour — tell the user this is not ' +
                        'documented and point them to Help Center or support@erp71.com. The areas the docs do cover ' +
                        'are listed above, in case the question fits one.',
                };
            }
            return {
                matchCount: matches.length,
                results: matches.map((m) => ({ section: m.section, question: m.q, answer: m.a })),
                guidance:
                    'Answer from these entries. Summarise rather than quoting in full, keep the exact page names, and ' +
                    'link to the relevant page when one is listed in "Pages you can link to".',
            };
        },
    },
];
