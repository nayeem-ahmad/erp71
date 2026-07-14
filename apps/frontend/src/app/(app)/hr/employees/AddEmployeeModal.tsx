'use client';

import { useState, useEffect } from 'react';
import { User, Phone, Mail, Calendar, Briefcase } from 'lucide-react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input, Select, FormGrid, Alert } from '@/components/ui';

interface AddEmployeeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (data: any) => Promise<void>;
}

const emptyForm = {
    name: '', phone: '', email: '', nid: '',
    date_of_joining: '', department_id: '', designation_id: '',
    basic_salary: '', status: 'ACTIVE',
};

export default function AddEmployeeModal({ isOpen, onClose, onAdd }: AddEmployeeModalProps) {
    const { t } = useI18n();
    const [formData, setFormData] = useState({ ...emptyForm });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [departments, setDepartments] = useState<any[]>([]);
    const [designations, setDesignations] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen) {
            api.getDepartments().then(setDepartments).catch(() => {});
            api.getDesignations().then(setDesignations).catch(() => {});
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const payload: any = { name: formData.name, phone: formData.phone, status: formData.status };
            if (formData.email) payload.email = formData.email;
            if (formData.nid) payload.nid = formData.nid;
            if (formData.date_of_joining) payload.date_of_joining = formData.date_of_joining;
            if (formData.department_id) payload.department_id = formData.department_id;
            if (formData.designation_id) payload.designation_id = formData.designation_id;
            if (formData.basic_salary) payload.basic_salary = Number(formData.basic_salary);

            await onAdd(payload);
            setFormData({ ...emptyForm });
            onClose();
        } catch (err: any) {
            setError(err.message || t.employees.modal.addFailed);
        } finally {
            setLoading(false);
        }
    };

    const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setFormData({ ...formData, [field]: e.target.value });

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
                <ModalHeader title={t.employees.modal.title} subtitle={t.employees.modal.subtitle} onClose={onClose} />

                <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
                    {error && <Alert tone="danger">{error}</Alert>}

                    <FormGrid>
                        <FormGrid.Full>
                            <Field label={t.employees.modal.fullName} required>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <Input required type="text" value={formData.name} onChange={set('name')}
                                        className="pl-10"
                                        placeholder={t.employees.modal.placeholders.name} />
                                </div>
                            </Field>
                        </FormGrid.Full>

                        <Field label={t.employees.modal.phone} required>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input required type="text" value={formData.phone} onChange={set('phone')}
                                    className="pl-10"
                                    placeholder={t.employees.modal.placeholders.phone} />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.email} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input type="email" value={formData.email} onChange={set('email')}
                                    className="pl-10"
                                    placeholder={t.employees.modal.placeholders.email} />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.dateOfJoining} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input type="date" value={formData.date_of_joining} onChange={set('date_of_joining')} className="pl-10" />
                            </div>
                        </Field>

                        <Field label={t.employees.modal.nationalId} hint={`(${t.common.optional})`}>
                            <Input type="text" value={formData.nid} onChange={set('nid')}
                                placeholder={t.employees.modal.placeholders.nationalId} />
                        </Field>

                        <Field label={t.employees.modal.department} hint={`(${t.common.optional})`}>
                            <div className="relative">
                                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Select value={formData.department_id} onChange={set('department_id')} className="pl-10">
                                    <option value="">{t.common.none}</option>
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </Select>
                            </div>
                        </Field>

                        <Field label={t.employees.modal.designation} hint={`(${t.common.optional})`}>
                            <Select value={formData.designation_id} onChange={set('designation_id')}>
                                <option value="">{t.common.none}</option>
                                {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </Select>
                        </Field>

                        <Field label={t.employees.modal.basicSalary} hint={`(${t.common.optional})`}>
                            <Input type="number" min="0" step="0.01" value={formData.basic_salary} onChange={set('basic_salary')}
                                placeholder="0.00" />
                        </Field>

                        <Field label={t.employees.modal.status}>
                            <Select value={formData.status} onChange={set('status')}>
                                <option value="ACTIVE">{t.employees.detail.active}</option>
                                <option value="INACTIVE">{t.employees.detail.inactive}</option>
                            </Select>
                        </Field>
                    </FormGrid>

                    <div className="pt-2">
                        <Button disabled={loading} loading={loading} type="submit" variant="primary" className="w-full justify-center">
                            {loading ? t.employees.modal.adding : t.employees.modal.addEmployee}
                        </Button>
                    </div>
                </form>
        </ModalShell>
    );
}