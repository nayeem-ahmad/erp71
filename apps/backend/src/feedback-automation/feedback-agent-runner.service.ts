import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { FeedbackGithubService, RepoWorkspace } from './feedback-github.service';

const execFileAsync = promisify(execFile);

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_MAX_TURNS = 40;
const MIN_MAX_TURNS = 5;
const MAX_TURNS_CAP = 100;
const MAX_FILE_BYTES = 200_000;
const MAX_TOOL_RESULT_CHARS = 20_000;

type ToolDefinition = {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
};

type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
};

export interface FeedbackContext {
    feedbackType: string;
    message: string;
    page?: string | null;
    adminInstruction: string;
    /** Present on a "request changes" revision — the prior plan + admin's feedback on it. */
    priorPlan?: string;
    priorComment?: string;
}

export interface PlanResult {
    planText: string;
    hasMigration: boolean;
    tokensUsed: number;
}

export interface ImplementResult {
    summary: string;
    filesChanged: string[];
    tokensUsed: number;
}

const READ_ONLY_TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List files and subdirectories at a path relative to the repo root.',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: 'Path relative to repo root, e.g. "apps/backend/src/feedback"' } },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a text file relative to the repo root.',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_code',
            description: 'Search the repo for a regex pattern (like grep -rn), returns matching file:line:text lines.',
            parameters: {
                type: 'object',
                properties: { pattern: { type: 'string' } },
                required: ['pattern'],
            },
        },
    },
];

const WRITE_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'write_file',
        description: 'Create or overwrite a text file relative to the repo root. Directories are created automatically.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
        },
    },
};

/**
 * Runs a Claude coding agent (via the existing OpenRouter integration, same
 * credential as AiService) against a disposable clone of the repo. Read-only
 * mode (propose a plan) never gets write_file; implement mode does, but even
 * then only ever writes to the workspace — committing/pushing/opening the PR
 * is done by our own code afterwards, never by the model itself.
 */
@Injectable()
export class FeedbackAgentRunnerService {
    private readonly logger = new Logger(FeedbackAgentRunnerService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly github: FeedbackGithubService,
    ) {}

    async proposePlan(context: FeedbackContext): Promise<PlanResult> {
        const workspace = await this.github.createWorkspace();
        try {
            const { text, tokensUsed } = await this.runToolLoop(
                workspace,
                this.buildPlanSystemPrompt(),
                this.buildPlanUserPrompt(context),
                READ_ONLY_TOOLS,
            );
            const hasMigration = this.parseMigrationFlag(text);
            return { planText: text, hasMigration, tokensUsed };
        } finally {
            await workspace.cleanup();
        }
    }

    /**
     * Implements an approved plan against a fresh workspace. Returns the
     * workspace (still on disk, caller must clean up) plus the branch to
     * push and the files touched, so the caller can run the migration-safety
     * scan before deciding whether to commit/push/open the PR.
     */
    async implementPlan(
        context: FeedbackContext & { planText: string },
        branch: string,
    ): Promise<ImplementResult & { workspace: RepoWorkspace }> {
        const workspace = await this.github.createWorkspace();
        const { text, tokensUsed } = await this.runToolLoop(
            workspace,
            this.buildImplementSystemPrompt(),
            this.buildImplementUserPrompt(context),
            [...READ_ONLY_TOOLS, WRITE_TOOL],
        );

        const filesChanged = await this.listChangedFiles(workspace.dir);
        return { summary: text, filesChanged, tokensUsed, workspace };
    }

    private buildPlanSystemPrompt(): string {
        return `You are a senior engineer on the ERP71 codebase (NestJS backend, Next.js 15 frontend, Prisma/Postgres, monorepo). \
A platform admin has approved a piece of tenant feedback and wants an implementation plan — NOT code. \
Use the list_dir/read_file/search_code tools to investigate the actual codebase before proposing anything; do not guess at file names or conventions. \
Prefer additive, reversible changes (new nullable columns, new files) over destructive ones (dropping/renaming columns, changing types). \
When you are done investigating, respond with your final answer as plain markdown (no tool call), structured as:

MIGRATION_REQUIRED: yes|no

## Root cause / approach
## Files to change
## Open questions for the admin (if any)

Keep it concrete — name real files and line numbers you found via the tools, not hypothetical ones.`;
    }

    private buildImplementSystemPrompt(): string {
        return `You are a senior engineer on the ERP71 codebase (NestJS backend, Next.js 15 frontend, Prisma/Postgres, monorepo). \
A platform admin has approved the implementation plan below. Implement it now using list_dir/read_file/search_code to understand existing conventions, then write_file for every file you add or change. \
Match this repo's existing conventions exactly (see CLAUDE.md: TenantInterceptor-scoped queries, permissions in packages/shared-types, Prisma migrations as hand-written SQL files under packages/database/prisma/migrations/<timestamp>_<name>/migration.sql). \
Do not run git commands or open a pull request yourself — that is handled outside this session. Do not touch anything outside the approved plan's scope. \
When finished, respond with a short plain-text summary of what you changed (no tool call).`;
    }

    private buildPlanUserPrompt(context: FeedbackContext): string {
        const revision = context.priorPlan
            ? `\n\nA previous plan version was proposed and the admin requested changes:\n\n--- previous plan ---\n${context.priorPlan}\n--- admin comment ---\n${context.priorComment}\n\nRevise the plan to address the admin's comment.`
            : '';
        return `Tenant feedback (type: ${context.feedbackType}${context.page ? `, page: ${context.page}` : ''}):\n"${context.message}"\n\nAdmin instruction:\n"${context.adminInstruction}"${revision}\n\nPropose an implementation plan.`;
    }

    private buildImplementUserPrompt(context: FeedbackContext & { planText: string }): string {
        return `Tenant feedback (type: ${context.feedbackType}${context.page ? `, page: ${context.page}` : ''}):\n"${context.message}"\n\nAdmin instruction:\n"${context.adminInstruction}"\n\nApproved plan:\n${context.planText}\n\nImplement this plan now.`;
    }

    private parseMigrationFlag(planText: string): boolean {
        const match = planText.match(/MIGRATION_REQUIRED:\s*(yes|no)/i);
        // Default to true (requires sign-off) when the model didn't follow the format —
        // safer to over-flag a migration than to silently skip the safety gate.
        return match ? match[1].toLowerCase() === 'yes' : true;
    }

    private async listChangedFiles(dir: string): Promise<string[]> {
        try {
            const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
            return stdout
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => line.replace(/^[AMD?U ]+\s*/, ''));
        } catch (err) {
            this.logger.warn(`Failed to list changed files: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }

    private async runToolLoop(
        workspace: RepoWorkspace,
        systemPrompt: string,
        userPrompt: string,
        tools: ToolDefinition[],
    ): Promise<{ text: string; tokensUsed: number }> {
        const settings = await this.platformSettings.getRawGroup('feedback_automation');
        // Reuses the same OpenRouter credential as the existing AiService (ai.api_key) —
        // this feature intentionally does not provision a separate Anthropic API key.
        const apiKey = (await this.platformSettings.getRawValue('ai', 'api_key'))
            ?? process.env.OPENROUTER_API_KEY
            ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new InternalServerErrorException('Feedback automation is not configured: no OpenRouter API key set (ai.api_key).');
        }
        const model = settings.model ?? 'anthropic/claude-sonnet-4.6';
        const maxTurns = this.resolveMaxTurns(settings.max_turns);
        const writeAllowed = tools.some((t) => t.function.name === 'write_file');

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
        let tokensUsed = 0;

        for (let turn = 0; turn < maxTurns; turn++) {
            // On the final allowed turn, withhold tools so the model is forced to
            // return a best-effort plan as plain text instead of the whole run
            // failing when it would otherwise keep exploring — common on large
            // repos where read-only investigation eats the turn budget.
            const isFinalTurn = turn === maxTurns - 1;
            const turnTools = isFinalTurn ? [] : tools;
            const { message, usage } = await this.callOpenRouter(apiKey, model, messages, turnTools);
            tokensUsed += (usage?.total_tokens ?? 0);

            if (!message.tool_calls || message.tool_calls.length === 0) {
                return { text: message.content ?? '', tokensUsed };
            }

            // Final turn had no tools available, so any tool_calls are moot —
            // take whatever text the model produced alongside them.
            if (isFinalTurn) {
                return { text: message.content ?? '', tokensUsed };
            }

            messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

            for (const call of message.tool_calls) {
                const result = await this.executeTool(workspace.dir, call.function.name, call.function.arguments, writeAllowed);
                messages.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
        }

        // Unreachable in practice — the final turn always returns above — but
        // keep a guard so the loop can never fall through silently.
        throw new InternalServerErrorException(`Agent did not finish within ${maxTurns} tool-call turns.`);
    }

    /** Resolve the per-run tool-call turn budget from platform settings, clamped to a safe range. */
    private resolveMaxTurns(raw: string | undefined): number {
        const parsed = Number.parseInt(raw ?? '', 10);
        if (!Number.isFinite(parsed)) {
            return DEFAULT_MAX_TURNS;
        }
        return Math.min(Math.max(parsed, MIN_MAX_TURNS), MAX_TURNS_CAP);
    }

    private async executeTool(repoDir: string, name: string, argsJson: string, writeAllowed: boolean): Promise<string> {
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argsJson || '{}');
        } catch {
            return 'Error: could not parse tool arguments as JSON.';
        }

        try {
            switch (name) {
                case 'list_dir':
                    return await this.toolListDir(repoDir, String(args.path ?? '.'));
                case 'read_file':
                    return await this.toolReadFile(repoDir, String(args.path ?? ''));
                case 'search_code':
                    return await this.toolSearchCode(repoDir, String(args.pattern ?? ''));
                case 'write_file':
                    if (!writeAllowed) return 'Error: write_file is not available in this mode.';
                    return await this.toolWriteFile(repoDir, String(args.path ?? ''), String(args.content ?? ''));
                default:
                    return `Error: unknown tool "${name}".`;
            }
        } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    /** Resolves a repo-relative path and guarantees it stays inside the workspace. */
    private resolveSafe(repoDir: string, relativePath: string): string {
        const resolved = path.resolve(repoDir, relativePath.replace(/^\/+/, ''));
        if (resolved !== repoDir && !resolved.startsWith(repoDir + path.sep)) {
            throw new Error(`Path "${relativePath}" escapes the repository root.`);
        }
        return resolved;
    }

    private async toolListDir(repoDir: string, relativePath: string): Promise<string> {
        const full = this.resolveSafe(repoDir, relativePath);
        const entries = await fs.readdir(full, { withFileTypes: true });
        return entries
            .filter((e) => e.name !== '.git')
            .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
            .join('\n') || '(empty directory)';
    }

    private async toolReadFile(repoDir: string, relativePath: string): Promise<string> {
        const full = this.resolveSafe(repoDir, relativePath);
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) {
            return `Error: file is ${stat.size} bytes, exceeds the ${MAX_FILE_BYTES}-byte read limit.`;
        }
        return await fs.readFile(full, 'utf8');
    }

    private async toolWriteFile(repoDir: string, relativePath: string, content: string): Promise<string> {
        const full = this.resolveSafe(repoDir, relativePath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, 'utf8');
        return `Wrote ${relativePath} (${content.length} chars).`;
    }

    private async toolSearchCode(repoDir: string, pattern: string): Promise<string> {
        if (!pattern.trim()) return 'Error: empty search pattern.';
        try {
            const { stdout } = await execFileAsync(
                'grep',
                ['-rn', '-I', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '-E', pattern, '.'],
                { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 },
            );
            return stdout.length > MAX_TOOL_RESULT_CHARS ? stdout.slice(0, MAX_TOOL_RESULT_CHARS) + '\n... (truncated)' : stdout;
        } catch (err: unknown) {
            const code = (err as { code?: number }).code;
            if (code === 1) return '(no matches)';
            throw err;
        }
    }

    private async callOpenRouter(
        apiKey: string,
        model: string,
        messages: ChatMessage[],
        tools: ToolDefinition[],
    ): Promise<{
        message: { content: string | null; tool_calls?: ChatMessage['tool_calls'] };
        usage?: { total_tokens?: number };
    }> {
        const referer = process.env.FRONTEND_URL ?? 'https://erp71.com';
        const title = process.env.OPENROUTER_APP_NAME ?? 'ERP71';

        // Omit `tools` entirely when empty — some providers reject an empty
        // tools array, and an empty array is how we force a final text answer.
        const payload: Record<string, unknown> = { model, messages, max_tokens: 4096 };
        if (tools.length > 0) {
            payload.tools = tools;
        }

        let response: Response;
        try {
            response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': referer,
                    'X-OpenRouter-Title': title,
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            throw new InternalServerErrorException(`Feedback agent request failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        const body = (await response.json()) as {
            choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatMessage['tool_calls'] } }>;
            usage?: { total_tokens?: number };
            error?: { message?: string };
        };
        if (!response.ok) {
            throw new InternalServerErrorException(`Feedback agent error: ${body.error?.message ?? response.status}`);
        }

        const message = body.choices?.[0]?.message ?? { content: '' };
        return { message: { content: message.content ?? '', tool_calls: message.tool_calls }, usage: body.usage };
    }
}
