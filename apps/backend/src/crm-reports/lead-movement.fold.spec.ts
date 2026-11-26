import { assignMovementStage, MovementLanding, MovementStageMeta } from './lead-movement.fold';

const NEW: MovementStageMeta = {
    id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW',
    is_system: true, is_active: true, sort_order: 1,
};
const CONTACTED: MovementStageMeta = {
    id: 'st-con', code: 'CONTACTED', name: 'Contacted', lifecycle: 'CONTACTED',
    is_system: true, is_active: true, sort_order: 2,
};
const QUALIFIED: MovementStageMeta = {
    id: 'st-qual', code: 'QUALIFIED', name: 'Qualified', lifecycle: 'QUALIFIED',
    is_system: true, is_active: true, sort_order: 3,
};
const NEGOTIATION: MovementStageMeta = {
    id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED',
    is_system: false, is_active: true, sort_order: 3,
};
const CONVERTED: MovementStageMeta = {
    id: 'st-won', code: 'CONVERTED', name: 'Converted', lifecycle: 'CONVERTED',
    is_system: true, is_active: true, sort_order: 4,
};
const LOST: MovementStageMeta = {
    id: 'st-lost', code: 'LOST', name: 'Lost', lifecycle: 'LOST',
    is_system: true, is_active: true, sort_order: 5,
};

const META = new Map<string, MovementStageMeta>(
    [NEW, CONTACTED, QUALIFIED, NEGOTIATION, CONVERTED, LOST].map((s) => [s.id, s]),
);

const ALL = new Set(META.keys());

function hide(...stages: MovementStageMeta[]): Set<string> {
    const ids = new Set(ALL);
    for (const stage of stages) ids.delete(stage.id);
    return ids;
}

function landing(
    stage: MovementStageMeta | null,
    createdAt: string,
    id: string,
): MovementLanding {
    return {
        id,
        leadId: 'lead-1',
        toStatusId: stage?.id ?? null,
        toLifecycle: stage?.lifecycle ?? 'LOST',
        createdAt: new Date(createdAt),
    };
}

function assign(
    landings: MovementLanding[],
    visibleIds: Set<string> = ALL,
): string | null {
    return assignMovementStage(landings, visibleIds, META);
}

describe('assignMovementStage', () => {
    it('counts New only as New', () => {
        expect(assign([landing(NEW, '2026-11-01T00:00:00Z', 'e1')])).toBe(NEW.id);
    });

    it('counts New → Contacted → Qualified as Qualified', () => {
        expect(assign([
            landing(NEW, '2026-11-01T00:00:00Z', 'e1'),
            landing(CONTACTED, '2026-11-02T00:00:00Z', 'e2'),
            landing(QUALIFIED, '2026-11-03T00:00:00Z', 'e3'),
        ])).toBe(QUALIFIED.id);
    });

    it('counts Qualified → Lost as Lost', () => {
        expect(assign([
            landing(QUALIFIED, '2026-11-01T00:00:00Z', 'e1'),
            landing(LOST, '2026-11-02T00:00:00Z', 'e2'),
        ])).toBe(LOST.id);
    });

    it('counts Lost → Qualified as Qualified', () => {
        expect(assign([
            landing(LOST, '2026-11-01T00:00:00Z', 'e1'),
            landing(QUALIFIED, '2026-11-02T00:00:00Z', 'e2'),
        ])).toBe(QUALIFIED.id);
    });

    it('counts New → Converted as Converted', () => {
        expect(assign([
            landing(NEW, '2026-11-01T00:00:00Z', 'e1'),
            landing(CONVERTED, '2026-11-02T00:00:00Z', 'e2'),
        ])).toBe(CONVERTED.id);
    });

    it('counts Negotiation only as Negotiation', () => {
        expect(assign([landing(NEGOTIATION, '2026-11-01T00:00:00Z', 'e1')])).toBe(NEGOTIATION.id);
    });

    it('skips hidden Contacted: New → Contacted counts as New', () => {
        expect(assign([
            landing(NEW, '2026-11-01T00:00:00Z', 'e1'),
            landing(CONTACTED, '2026-11-02T00:00:00Z', 'e2'),
        ], hide(CONTACTED))).toBe(NEW.id);
    });

    it('skips hidden Contacted: Contacted only is omitted', () => {
        expect(assign(
            [landing(CONTACTED, '2026-11-01T00:00:00Z', 'e1')],
            hide(CONTACTED),
        )).toBeNull();
    });

    it('skips hidden Contacted: Contacted → Qualified counts as Qualified', () => {
        expect(assign([
            landing(CONTACTED, '2026-11-01T00:00:00Z', 'e1'),
            landing(QUALIFIED, '2026-11-02T00:00:00Z', 'e2'),
        ], hide(CONTACTED))).toBe(QUALIFIED.id);
    });

    it('skips hidden Lost: Qualified → Lost counts as Qualified', () => {
        expect(assign([
            landing(QUALIFIED, '2026-11-01T00:00:00Z', 'e1'),
            landing(LOST, '2026-11-02T00:00:00Z', 'e2'),
        ], hide(LOST))).toBe(QUALIFIED.id);
    });

    it('skips hidden Lost: Lost only is omitted', () => {
        expect(assign(
            [landing(LOST, '2026-11-01T00:00:00Z', 'e1')],
            hide(LOST),
        )).toBeNull();
    });

    it('breaks a same-createdAt tie by id ascending so Lost is latest', () => {
        const at = '2026-11-01T12:00:00Z';
        expect(assign([
            landing(QUALIFIED, at, 'evt-1'),
            landing(LOST, at, 'evt-2'),
        ])).toBe(LOST.id);
    });

    it('ignores a landing with toStatusId null, remaining New', () => {
        expect(assign([
            landing(NEW, '2026-11-01T00:00:00Z', 'e1'),
            landing(null, '2026-11-02T00:00:00Z', 'e2'),
        ])).toBe(NEW.id);
    });
});
