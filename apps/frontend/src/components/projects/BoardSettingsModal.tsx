'use client';

import { Button } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { useI18n } from '@/lib/i18n';
import BoardSettingsPanel from './BoardSettingsPanel';
import type { BoardBackground } from './board-background';
import type { BoardProject } from './board-tasks';
import type { BoardViewControls } from './use-board-view';

/**
 * Board settings, over the board it belongs to.
 *
 * A modal rather than the page it used to be: every one of these settings is
 * about the board behind it, and navigating away to change a column name meant
 * losing the scroll position, the filters and the selection you were working
 * with. Nothing here has a Save button — each control commits on its own — so
 * closing is genuinely just closing.
 */
export default function BoardSettingsModal({
    boardId,
    boardName,
    boardView,
    background,
    projectsOnBoard,
    onBackgroundChanged,
    onColumnsChanged,
    onClose,
}: Readonly<{
    boardId: string;
    boardName: string;
    boardView: BoardViewControls;
    background: BoardBackground;
    projectsOnBoard: BoardProject[];
    onBackgroundChanged: (next: BoardBackground) => void;
    onColumnsChanged?: () => void;
    onClose: () => void;
}>) {
    const { t } = useI18n();
    const m = t.projects.boards;

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader
                title={m.boardSettings}
                subtitle={boardName}
                onClose={onClose}
                closeLabel={t.common.close}
            />

            <div className="flex-1 overflow-y-auto p-4">
                <BoardSettingsPanel
                    boardId={boardId}
                    boardView={boardView}
                    background={background}
                    projectsOnBoard={projectsOnBoard}
                    onBackgroundChanged={onBackgroundChanged}
                    onColumnsChanged={onColumnsChanged}
                />
            </div>

            <ModalFooter>
                <Button variant="secondary" className="min-h-touch" onClick={onClose}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
