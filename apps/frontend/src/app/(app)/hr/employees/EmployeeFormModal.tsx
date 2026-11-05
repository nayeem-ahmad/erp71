'use client';

import { useState, useEffect } from 'react';
import { User, Phone, Mail, Calendar, Briefcase } from 'lucide-react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';
import { Button, Field, Input, Select, FormGrid, Alert } from '@/components/ui';
import { useBranchScope } from '@/lib/branch-scope';
import {
    codeLabel, groupByDepartment, pickable, reportsToLabel,
    type Department, type Designation,
} from '@/lib/org-structure';

/** The fields of a list row the edit form fills from. */
export interface EditableEmployee {
    id: string;
    employee_code: string;
    name: string;
    phone: string;
    email?: string | null;
    nid?: string | null;
    date_of_joining?: string | null;
    department_id?: string | null;
    designation_id?: string | null;
    basic_salary?: string | number | null;
    store_id?: string | null;
}

interface EmployeeFormModalProps {
    isOpen: boolean;
    /** The employee being edited; without one the form adds a new employee. */
    employee?: EditableEmployee | null;
    onClose: () => void;
    onSubmit: (data: any) => Promise<void>;
}

const emptyForm = {
    name: '', phone: '', email: '', nid: '',
    date_of_joining: '', department_id: '', designation_id: '',
    basic_salary: '', status: 'ACTIVE', store_id: '',
};

function formFor(employee: EditableEmployee) {
    return {
        name: employee.name ?? '',
        phone: employee.phone ?? '',
        email: employee.email ?? '',
        nid: employee.nid ?? '',
        date_of_joining: employee.date_of_joining ? employee.date_of_joining.split('T')[0] : '',
        department_id: employee.department_id ?? '',
        designation_id: employee.designation_id ?? '',
        basic_salary: employee.basic_salary != null ? String(employee.basic_salary) : '',
        status: 'ACTIVE',
        store_id: employee.store_id ?? '',
    };
}

export default function EmployeeFormModal({ isOpen, employee, onClose, onSubmit }: EmployeeFormModalProps) {
    const { t } = useI18n();
    const branch = useBranchScope();
    const editing = Boolean(employee);
    // The server drops `basic_salary` from a caller without VIEW_PAYROLL, so
    // showing the field to one would silently discard whatever they typed. An
    // edited row says it outright: the server leaves the key off for them.
    const { permissions, role } = useTenantPlanFeatures();
    const canSeeSalary = employee
        ? 'basic_salary' in employee
        : isOwner(role) || hasPermission(permissions, 'VIEW_PAYROLL');
    const [formData, setFormData] = useState({ ...emptyForm });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [departments, setDepartments] = useState<Department[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);

    useEffect(() => {
        if (isOpen) {
            const next = employee ? formFor(employee) : { ...emptyForm };
            if (!next.store_id) next.store_id = branch.headerBranchId ?? '';
            setFormData(next);
            setError('');
            api.getDepartments().then(setDepartments).catch(() => {});
            api.getDesignations().then(setDesignations).catch(() => {});
        }
    }, [isOpen, employee, branch.headerBranchId]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.store_id) {
            setError(t.employees.modal.branchRequired);
            return;
        }
        setError('');
        setLoading(true);
        try {
            const payload: any = { name: formData.name, phone: formData.phone, storeId: formData.store_id };
            if (formData.email) payload.email = formData.email;
            if (formData.nid) payload.nid = formData.nid;
            if (formData.date_of_joining) payload.date_of_joining = formData.date_of_joining;
            if (editing) {
                // Status is left alone: it moves through the list's Activate /
                // Deactivate. Emptied pickers clear, as on the detail page.
                payload.department_id = formData.department_id || null;
                payload.designation_id = formData.designation_id || null;
                if (canSeeSalary) payload.basic_salary = formData.basic_salary !== '' ? Number(formData.basic_salary) : null;
            } else {
                payload.status = formData.status;
                if (formData.department_id) payload.department_id = formData.department_id;
                if (formData.designation_id) payload.designation_id = formData.designation_id;
                if (canSeeSalary && formData.basic_salary) payload.basic_salary = Number(formData.basic_salary);
            }

            await onSubmit(payload);
            setFormData({ ...emptyForm });
            onClose();
        } catch (err: any) {
            setError(err.message || (editing ? t.employees.detail.updateFailed : t.employees.modal.addFailed));
        } finally {
            setLoading(false);
        }
    };

    const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setFormData({ ...formData, [field]: e.target.value });

    // Picking a designation fills in its department, which is almost always
    // where the person works. It stays editable: a trainee's designation sits
    // under "General" but they work in one real department.
    const chooseDesignation = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const designationId = e.target.value;
        const chosen = designations.find((d) => d.id === designationId);
        const deptId = chosen?.department_id;
        const deptPickable = deptId && departments.some((d) => d.id === deptId && d.is_active !== false);
        setFormData({
            ...formData,
            designation_id: designationId,
            ...(deptPickable ? { department_id: deptId } : {}),
        });
    };

    // New choices come from active records; an inactive one already on the
    // employee stays visible so editing does not silently drop it.
    const departmentOptions = pickable(departments, employee?.department_id);
    const designationGroups = groupByDepartment(
        pickable(designations, employee?.designation_id),
        t.orgStructure.noDepartment,
    );
    const selectedDesignation = designations.find((d) => d.id === formData.designation_id);
    const reportsTo = reportsToLabel(selectedDesignation);
    const inactive = (item: { is_active?: boolean }) => (item.is_active === false ? ` ${t.orgStructure.inactiveSuffix}` : '');

    const submitLabel = editing
        ? (loading ? t.employees.detail.saving : t.common.saveChanges)
        : (loading ? t.employees.modal.adding : t.employees.modal.addEmployee);

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
                <ModalHeader
                    title={editing ? t.employees.editEmployee : t.employees.modal.title}
                    subtitle={employee ? employee.employee_code : t.employees.modal.subtitle}
                    onClose={onClose}
                />

                <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
                    {error && <Alert tone="danger">{error}</Alert>}

                    <FormGrid>
                        <FormGrid.Full>
                            <Field label={t.employees.modal.fullName} required>
                                <div className="relative">
                                    <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <Input required type="text" value={formData.name} onChange={set('name')}
                                        className="ps-10"
                                        placeholder={t.employees.modal.placeholders.name} />
                                </div>
                            </Field>
                        </FormGrid.Full>

                        <Field label={t.employees.modal.phone} required>
                            <div className="relative">
                                <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input required type="text" value={formData.phone} onChange={set('phone')}
                                    className="ps-10"
                                    placeholder={t.employees.modal.placeholders.phone} />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.email} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input type="email" value={formData.email} onChange={set('email')}
                                    className="ps-10"
                                    placeholder={t.employees.modal.placeholders.email} />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.dateOfJoining} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input type="date" value={formData.date_of_joining} onChange={set('date_of_joining')} className="ps-10" />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.nationalId} hint={`(${t.common.optional})`}>
                            <Input type="text" value={formData.nid} onChange={set('nid')}
                                placeholder={t.employees.modal.placeholders.nationalId} />
                        </Field>

                        <Field label={t.employees.modal.branch} required>
                            <Select
                                required
                                aria-label={t.employees.modal.branch}
                                value={formData.store_id}
                                onChange={set('store_id')}
                                disabled={branch.locked}
                            >
                                <option value="">{t.employees.modal.branch}</option>
                                {branch.branches.map((store) => (
                                    <option key={store.id} value={store.id}>{store.name}</option>
                                ))}
                            </Select>
                        </Field>


                        <FormGrid.Full>
                            <Field
                                label={t.employees.modal.designation}
                                hint={reportsTo ? `${t.orgStructure.reportsTo}: ${reportsTo}` : `(${t.common.optional})`}
                            >
                                <Select value={formData.designation_id} onChange={chooseDesignation} aria-label={t.employees.modal.designation}>
                                    <option value="">{t.common.none}</option>
                                    {designationGroups.map((group) => (
                                        <optgroup key={group.label} label={group.label}>
                                            {group.items.map((d) => (
                                                <option key={d.id} value={d.id}>{codeLabel(d)}{inactive(d)}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </Select>
                            </Field>
                        </FormGrid.Full>

                        <Field label={t.employees.modal.department} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Briefcase className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Select value={formData.department_id} onChange={set('department_id')} className="ps-10">
                                    <option value="">{t.common.none}</option>
                                    {departmentOptions.map(d => <option key={d.id} value={d.id}>{codeLabel(d)}{inactive(d)}</option>)}
                                </Select>
                            </div>
                        </Field>

                        {canSeeSalary && (
                        <Field label={t.employees.modal.basicSalary} hint={`(${t.common.optional})`}>
                            <Input type="number" min="0" step="0.01" value={formData.basic_salary} onChange={set('basic_salary')}
                                placeholder="0.00" />
                        </Field>
                        )}

                        {!editing && (
                        <Field label={t.employees.modal.status}>
                            <Select value={formData.status} onChange={set('status')}>
                                <option value="ACTIVE">{t.employees.detail.active}</option>
                                <option value="INACTIVE">{t.employees.detail.inactive}</option>
                            </Select>
                        </Field>
                        )}
                    </FormGrid>

                    <div className="pt-2">
                        <Button disabled={loading} loading={loading} type="submit" variant="primary" className="w-full justify-center">
                            {submitLabel}
                        </Button>
                    </div>
                </form>
        </ModalShell>
    );
}
