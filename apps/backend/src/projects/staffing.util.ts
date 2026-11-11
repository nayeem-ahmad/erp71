/**
 * People × projects merge for the staffing matrix. Pure — no Nest, no Prisma.
 * Hours assigned to a linked employee add onto that user; a manager with no
 * member row still occupies a MANAGER cell; null remaining counts as 0.
 */

export const OVERLOAD_THRESHOLD = 3;

export const STAFFING_DEFAULT_STATUSES = ['ACTIVE', 'ON_HOLD'];

/** Same five codes as `VALID_STATUSES` in `projects.service.ts`. */
const PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

const UNASSIGNED_KEY = 'unassigned';

export type StaffingRole = 'MANAGER' | 'MEMBER' | 'VIEWER';

export interface StaffingCell {
    role: StaffingRole | null;
    isManager: boolean;
    remainingHours: number;
    openTasks: number;
    assignedNotOnTeam: boolean;
}

export interface StaffingPerson {
    key: string;
    kind: 'user' | 'employee' | 'unassigned';
    id: string | null;
    name: string;
    email: string | null;
    noLogin: boolean;
    cells: Record<string, StaffingCell>;
    totals: { projectCount: number; remainingHours: number; openTasks: number };
}

export interface StaffingProject {
    id: string;
    code: string;
    shortName: string | null;
    name: string;
    status: string;
}

export interface StaffingResponse {
    projects: StaffingProject[];
    people: StaffingPerson[];
    summary: {
        people: number;
        projects: number;
        remainingHours: number;
        unassignedRemainingHours: number;
        unassignedOpenTasks: number;
        overloaded: number;
    };
}

export interface StaffingUserRef {
    id: string;
    name: string | null;
    email: string;
}

export interface StaffingEmployeeRef {
    id: string;
    name: string;
    employee_code: string | null;
}

export interface MergeStaffingInput {
    projects: StaffingProject[];
    members: Array<{
        projectId: string;
        userId?: string | null;
        employeeId?: string | null;
        role: StaffingRole;
        user?: StaffingUserRef | null;
        employee?: StaffingEmployeeRef | null;
    }>;
    managers: Array<{
        projectId: string;
        userId: string;
        name: string | null;
        email: string | null;
    }>;
    hours: Array<{
        projectId: string;
        userId?: string | null;
        employeeId?: string | null;
        remainingHours: number;
        openTasks: number;
        /** Present when the loader looked up an hours-only assignee. */
        user?: StaffingUserRef | null;
        employee?: StaffingEmployeeRef | null;
    }>;
    linkedEmployees: Array<{ employeeId: string; userId: string }>;
}

export function personKey(kind: 'user' | 'employee', id: string): string {
    return `${kind}:${id}`;
}

export function parseStaffingStatuses(raw: string | undefined): string[] {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) return [...STAFFING_DEFAULT_STATUSES];
    if (trimmed.toUpperCase() === 'ALL') return [...PROJECT_STATUSES];

    const seen = new Set<string>();
    const statuses: string[] = [];
    for (const token of trimmed.split(',')) {
        const code = token.trim().toUpperCase();
        if (!PROJECT_STATUSES.includes(code) || seen.has(code)) continue;
        seen.add(code);
        statuses.push(code);
    }
    return statuses;
}

type PersonKind = StaffingPerson['kind'];

interface PersonAcc {
    key: string;
    kind: PersonKind;
    id: string | null;
    name: string;
    email: string | null;
    noLogin: boolean;
    cells: Map<string, CellAcc>;
}

interface CellAcc {
    role: StaffingRole | null;
    isManager: boolean;
    remainingHours: number;
    openTasks: number;
    onTeam: boolean;
}

function asCount(value: number | null | undefined): number {
    return value ?? 0;
}

function resolveRef(
    employeeToUser: Map<string, string>,
    userId?: string | null,
    employeeId?: string | null,
): { key: string; kind: PersonKind; id: string | null } {
    if (userId) return { key: personKey('user', userId), kind: 'user', id: userId };
    if (employeeId) {
        const linkedUserId = employeeToUser.get(employeeId);
        if (linkedUserId) {
            return { key: personKey('user', linkedUserId), kind: 'user', id: linkedUserId };
        }
        return { key: personKey('employee', employeeId), kind: 'employee', id: employeeId };
    }
    return { key: UNASSIGNED_KEY, kind: 'unassigned', id: null };
}

function fillName(person: PersonAcc, name: string | null | undefined, email: string | null | undefined) {
    const label = name || email;
    if (label && (!person.name || person.name === person.id)) person.name = label;
    if (email && !person.email) person.email = email;
}

export function mergeStaffing(input: MergeStaffingInput): StaffingResponse {
    const projects = [...input.projects].sort((a, b) => a.code.localeCompare(b.code));
    const knownProjects = new Set(projects.map((project) => project.id));
    const employeeToUser = new Map(
        input.linkedEmployees.map((row) => [row.employeeId, row.userId]),
    );
    const people = new Map<string, PersonAcc>();

    const ensure = (ref: { key: string; kind: PersonKind; id: string | null }): PersonAcc => {
        let person = people.get(ref.key);
        if (!person) {
            person = {
                key: ref.key,
                kind: ref.kind,
                id: ref.id,
                name: ref.kind === 'unassigned' ? 'Unassigned' : (ref.id ?? ''),
                email: null,
                noLogin: ref.kind === 'employee',
                cells: new Map(),
            };
            people.set(ref.key, person);
        }
        return person;
    };

    const cellOf = (person: PersonAcc, projectId: string): CellAcc => {
        let cell = person.cells.get(projectId);
        if (!cell) {
            cell = { role: null, isManager: false, remainingHours: 0, openTasks: 0, onTeam: false };
            person.cells.set(projectId, cell);
        }
        return cell;
    };

    const applyIdentity = (
        person: PersonAcc,
        user?: StaffingUserRef | null,
        employee?: StaffingEmployeeRef | null,
        fallback?: { name?: string | null; email?: string | null },
    ) => {
        if (user) {
            fillName(person, user.name, user.email);
            person.noLogin = false;
        } else if (fallback) {
            fillName(person, fallback.name, fallback.email);
            if (person.kind === 'user') person.noLogin = false;
        }
        if (employee) fillName(person, employee.name, null);
        if (person.kind === 'employee') person.noLogin = true;
    };

    for (const member of input.members) {
        if (!knownProjects.has(member.projectId)) continue;
        const ref = resolveRef(
            employeeToUser,
            member.userId ?? member.user?.id,
            member.employeeId ?? member.employee?.id,
        );
        if (ref.kind === 'unassigned') continue;
        const person = ensure(ref);
        applyIdentity(person, member.user, member.employee);
        const cell = cellOf(person, member.projectId);
        cell.role = member.role;
        cell.onTeam = true;
    }

    for (const manager of input.managers) {
        if (!knownProjects.has(manager.projectId)) continue;
        const person = ensure(resolveRef(employeeToUser, manager.userId, null));
        applyIdentity(person, null, null, { name: manager.name, email: manager.email });
        const cell = cellOf(person, manager.projectId);
        cell.isManager = true;
        cell.onTeam = true;
        if (!cell.role) cell.role = 'MANAGER';
    }

    for (const row of input.hours) {
        if (!knownProjects.has(row.projectId)) continue;
        const person = ensure(
            resolveRef(employeeToUser, row.userId ?? row.user?.id, row.employeeId ?? row.employee?.id),
        );
        applyIdentity(person, row.user, row.employee);
        const cell = cellOf(person, row.projectId);
        cell.remainingHours += asCount(row.remainingHours);
        cell.openTasks += asCount(row.openTasks);
    }

    const peopleOut: StaffingPerson[] = [...people.values()].map((person) => {
        const cells: Record<string, StaffingCell> = {};
        let remainingHours = 0;
        let openTasks = 0;
        for (const [projectId, cell] of person.cells) {
            cells[projectId] = {
                role: cell.role,
                isManager: cell.isManager,
                remainingHours: cell.remainingHours,
                openTasks: cell.openTasks,
                assignedNotOnTeam: !cell.onTeam,
            };
            remainingHours += cell.remainingHours;
            openTasks += cell.openTasks;
        }
        return {
            key: person.key,
            kind: person.kind,
            id: person.id,
            name: person.name,
            email: person.email,
            noLogin: person.noLogin,
            cells,
            totals: { projectCount: person.cells.size, remainingHours, openTasks },
        };
    });

    peopleOut.sort((a, b) => {
        if (a.kind === 'unassigned') return 1;
        if (b.kind === 'unassigned') return -1;
        return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
    });

    const assigned = peopleOut.filter((person) => person.kind !== 'unassigned');
    const unassigned = peopleOut.find((person) => person.kind === 'unassigned');

    return {
        projects,
        people: peopleOut,
        summary: {
            people: assigned.length,
            projects: projects.length,
            remainingHours: assigned.reduce((sum, person) => sum + person.totals.remainingHours, 0),
            unassignedRemainingHours: unassigned?.totals.remainingHours ?? 0,
            unassignedOpenTasks: unassigned?.totals.openTasks ?? 0,
            overloaded: assigned.filter((person) => person.totals.projectCount >= OVERLOAD_THRESHOLD).length,
        },
    };
}
