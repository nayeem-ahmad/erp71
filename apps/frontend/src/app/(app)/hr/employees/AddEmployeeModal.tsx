'use client';

import { useState, useEffect } from 'react';
import { X, User, Phone, Mail, Calendar, Briefcase } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">{t.employees.modal.title}</h2>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">{t.employees.modal.subtitle}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-all">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                    {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.fullName}</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={formData.name} onChange={set('name')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-black focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                    placeholder={t.employees.modal.placeholders.name} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.phone}</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={formData.phone} onChange={set('phone')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-black focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                    placeholder={t.employees.modal.placeholders.phone} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.email} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="email" value={formData.email} onChange={set('email')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                    placeholder={t.employees.modal.placeholders.email} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.dateOfJoining} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="date" value={formData.date_of_joining} onChange={set('date_of_joining')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.nationalId} <span className="text-gray-300">({t.common.optional})</span></label>
                            <input type="text" value={formData.nid} onChange={set('nid')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                placeholder={t.employees.modal.placeholders.nationalId} />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.department} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <select value={formData.department_id} onChange={set('department_id')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none">
                                    <option value="">{t.common.none}</option>
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.designation} <span className="text-gray-300">({t.common.optional})</span></label>
                            <select value={formData.designation_id} onChange={set('designation_id')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="">{t.common.none}</option>
                                {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.basicSalary} <span className="text-gray-300">({t.common.optional})</span></label>
                            <input type="number" min="0" step="0.01" value={formData.basic_salary} onChange={set('basic_salary')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                placeholder="0.00" />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.status}</label>
                            <select value={formData.status} onChange={set('status')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-black text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="ACTIVE">{t.employees.detail.active}</option>
                                <option value="INACTIVE">{t.employees.detail.inactive}</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button disabled={loading} type="submit"
                            className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center transition-all bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 hover:-translate-y-0.5 disabled:opacity-50">
                            {loading ? t.employees.modal.adding : t.employees.modal.addEmployee}
                        </button>
                    </div>
                </form>
        </ModalShell>
    );
}