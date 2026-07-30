import { AUDIT_TOOLS } from './tools/audit.tools';
import { FINANCE_TOOLS } from './tools/finance.tools';
import { HELP_TOOLS } from './tools/help.tools';
import { INVENTORY_TOOLS } from './tools/inventory.tools';
import { META_TOOLS } from './tools/meta.tools';
import { OPERATIONS_TOOLS } from './tools/operations.tools';
import { PARTY_TOOLS } from './tools/parties.tools';
import { PURCHASING_TOOLS } from './tools/purchasing.tools';
import { SALES_TOOLS } from './tools/sales.tools';
import { WEB_TOOLS } from './tools/web.tools';
import type { ChatTool } from './tools/types';

/**
 * The read-only tool menu the data chatbot may call, assembled from the
 * per-domain files under `./tools`.
 *
 * Ordering is not cosmetic: the model reads the list top to bottom, and the
 * general-purpose lookups (`resolve_entity`, `describe_capabilities`) belong
 * near the front because almost every specific question starts with one.
 */
export const CHAT_TOOLS: ChatTool[] = [
    ...META_TOOLS,
    // How-to / product questions are common and orthogonal to the data tools, so
    // the help lookup sits near the front where the model reads it early.
    ...HELP_TOOLS,
    ...SALES_TOOLS,
    ...INVENTORY_TOOLS,
    ...PURCHASING_TOOLS,
    ...PARTY_TOOLS,
    ...FINANCE_TOOLS,
    ...OPERATIONS_TOOLS,
    // The only tool that goes looking for problems rather than answering a
    // question, so it sits apart from the reporting tools it would otherwise be
    // confused with. A question about what happened wants a report; a question
    // about whether anything is *wrong* wants this.
    ...AUDIT_TOOLS,
    // Last on purpose. Everything above answers from the tenant's own database,
    // which is what almost every question wants; the web is the fallback for the
    // minority that reach outside, and reading the list in that order is the
    // preference we want the model to have.
    ...WEB_TOOLS,
];

export const CHAT_TOOLS_BY_NAME: Record<string, ChatTool> = Object.fromEntries(
    CHAT_TOOLS.map((tool) => [tool.name, tool]),
);

/** OpenRouter/OpenAI `tools` wire format for the subset the caller may use. */
export function toOpenRouterTools(tools: ChatTool[]) {
    return tools.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

export {
    MAX_TOOL_ROWS,
    type ChatTool,
    type ChatToolContext,
    type ChatToolDeps,
    type ChatToolFeatureFlag,
    type ChatToolModule,
} from './tools/types';
