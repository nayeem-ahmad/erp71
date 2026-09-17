'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell, PageHeader, Button } from '@/components/ui';
import BoardSettingsPanel from '@/components/projects/BoardSettingsPanel';
import { useBoardView } from '@/components/projects/use-board-view';
import type { BoardBackground } from '@/components/projects/board-background';
import type { BoardProject, BoardTask } from '@/components/projects/board-tasks';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface BoardSummary extends BoardBackground {
    name: string | null;
}

/** The subset of `api.getBoard`'s answer this page reads. */
interface BoardDetail extends BoardSummary {
    columns?: { tasks?: BoardTask[] }[];
    unsorted?: BoardTask[];
}

/** Every project holding a card on the board, bound to a column or not. */
function projectsOf(board: BoardDetail | null): BoardProject[] {
    const tasks = [
        ...(board?.columns ?? []).flatMap((column) => column.tasks ?? []),
        ...(board?.unsorted ?? []),
    ];
    const byId = new Map<string, BoardProject>();
    for (const task of tasks) {
        if (task.project) byId.set(task.project.id, task.project);
    }
    return [...byId.values()];
}

/**
 * Board settings as a page of its own.
 *
 * The board itself now opens the same panel in a modal, which is where the
 * settings are actually reached from — this route stays because it is where
 * they lived before (and where a bookmark or an old link still points), and
 * because a panel that only exists inside a modal cannot be linked to at all.
 * Both render `BoardSettingsPanel`, so there is one implementation and two
 * shells rather than two screens drifting apart.
 */
export default function BoardSettingsPage() {
    const params = useParams<{ id: string }>();
    const boardId = params.id;
    const { t } = useI18n();
    const m = t.projects.boards;

    const boardView = useBoardView();
    const [board, setBoard] = useState<BoardSummary>({ name: null });
    const [projectsOnBoard, setProjectsOnBoard] = useState<BoardProject[]>([]);

    useEffect(() => {
        api.getBoard(boardId)
            .then((res: unknown) => {
                const detail = res as BoardDetail | null;
                setBoard({
                    name: detail?.name ?? null,
                    background_color: detail?.background_color ?? null,
                    background_image_url: detail?.background_image_url ?? null,
                });
                setProjectsOnBoard(projectsOf(detail));
            })
            .catch(() => {
                setBoard({ name: null });
                setProjectsOnBoard([]);
            });
    }, [boardId]);

    return (
        <PageShell>
            <PageHeader
                title={m.boardSettings}
                subtitle={board.name ?? undefined}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    'projects',
                    [
                        {
                            label: board.name ?? m.title,
                            href: routes.projects.boardDetail(boardId),
                        },
                    ],
                    m.boardSettings,
                )}
                actions={
                    <Link href={routes.projects.boardDetail(boardId)}>
                        <Button variant="secondary" className="max-md:min-h-touch">
                            {m.backToBoard}
                        </Button>
                    </Link>
                }
            />

            <BoardSettingsPanel
                boardId={boardId}
                boardView={boardView}
                background={board}
                projectsOnBoard={projectsOnBoard}
                onBackgroundChanged={(next) =>
                    setBoard((prev) => ({
                        ...prev,
                        background_color: next.background_color ?? null,
                        background_image_url: next.background_image_url ?? null,
                    }))
                }
            />
        </PageShell>
    );
}
