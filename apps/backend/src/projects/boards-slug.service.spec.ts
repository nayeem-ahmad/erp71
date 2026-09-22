import { BoardsService } from './boards.service';

function makeDb() {
    return {
        board: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        },
        boardSlugHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
}

function makeService(db: ReturnType<typeof makeDb>) {
    return new BoardsService(db as never, {} as never, {} as never, {} as never, {} as never);
}

describe('resolving a board by slug', () => {
    let db: ReturnType<typeof makeDb>;
    let service: BoardsService;

    beforeEach(() => {
        db = makeDb();
        service = makeService(db);
    });

    it('resolves a current slug without reporting a move', async () => {
        db.board.findFirst.mockResolvedValue({ id: 'b1', slug: 'erp71' });

        expect(await service.resolveSlug('t1', 'erp71')).toEqual({
            boardId: 'b1',
            currentSlug: 'erp71',
            moved: false,
        });
    });

    it('resolves a retired slug and reports the move', async () => {
        // A link pasted before the board was renamed still has to work.
        db.board.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'b1', slug: 'platform' });
        db.boardSlugHistory.findFirst.mockResolvedValue({ board_id: 'b1' });

        expect(await service.resolveSlug('t1', 'erp71')).toEqual({
            boardId: 'b1',
            currentSlug: 'platform',
            moved: true,
        });
    });

    it('returns null for a slug nobody has ever held', async () => {
        expect(await service.resolveSlug('t1', 'nope')).toBeNull();
    });

    it('returns null when history points at a board since deleted', async () => {
        db.board.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        db.boardSlugHistory.findFirst.mockResolvedValue({ board_id: 'gone' });

        expect(await service.resolveSlug('t1', 'erp71')).toBeNull();
    });

    it('scopes the lookup to the tenant', async () => {
        db.board.findFirst.mockResolvedValue({ id: 'b1', slug: 'erp71' });
        await service.resolveSlug('t1', 'erp71');

        expect(db.board.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 't1', deleted_at: null }),
            }),
        );
    });
});

describe('choosing a slug for a board', () => {
    let db: ReturnType<typeof makeDb>;
    let service: BoardsService;

    beforeEach(() => {
        db = makeDb();
        service = makeService(db);
    });

    it('derives it from the name', async () => {
        expect(await service.nextSlug('t1', 'OTB tahsin')).toBe('otb-tahsin');
    });

    it('disambiguates against a slug already taken', async () => {
        db.board.findMany.mockResolvedValue([{ slug: 'otb' }]);
        expect(await service.nextSlug('t1', 'OTB')).toBe('otb-2');
    });

    it('disambiguates against a slug held only by history', async () => {
        // A freed slug must not be reusable, or it steals the old board's links.
        db.boardSlugHistory.findMany.mockResolvedValue([{ slug: 'otb' }]);
        expect(await service.nextSlug('t1', 'OTB')).toBe('otb-2');
    });

    it('falls back to the id when a name yields no slug', async () => {
        expect(await service.nextSlug('t1', '!!!', 'aabbccdd-1111-2222-3333-444455556666')).toBe(
            'board-aabbccdd',
        );
    });
});
