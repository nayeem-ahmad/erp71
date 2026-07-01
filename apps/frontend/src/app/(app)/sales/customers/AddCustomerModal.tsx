import { useState, useEffect } from 'react';
import { X, User, Phone, Mail, MapPin, CreditCard, Percent } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface AddCustomerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (data: any) => Promise<void>;
}

const emptyForm = {
    name: '', phone: '', email: '', address: '', profile_pic_url: '',
    customer_type: 'INDIVIDUAL', customer_group_id: '', territory_id: '',
    credit_limit: '', default_discount_pct: '',
};

export default function AddCustomerModal({ isOpen, onClose, onAdd }: AddCustomerModalProps) {
    const { t } = useI18n();
    const [formData, setFormData] = useState({ ...emptyForm });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [groups, setGroups] = useState<any[]>([]);
    const [territories, setTerritories] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen) {
            api.getCustomerGroups().then(setGroups).catch(() => {});
            api.getTerritories().then(setTerritories).catch(() => {});
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const payload: any = {
                name: formData.name,
                phone: formData.phone,
                customer_type: formData.customer_type,
            };
            if (formData.email) payload.email = formData.email;
            if (formData.address) payload.address = formData.address;
            if (formData.profile_pic_url) payload.profile_pic_url = formData.profile_pic_url;
            if (formData.customer_group_id) payload.customer_group_id = formData.customer_group_id;
            if (formData.territory_id) payload.territory_id = formData.territory_id;
            if (formData.credit_limit) payload.credit_limit = parseFloat(formData.credit_limit);
            if (formData.default_discount_pct) payload.default_discount_pct = parseFloat(formData.default_discount_pct);

            await onAdd(payload);
            setFormData({ ...emptyForm });
            onClose();
        } catch (err: any) {
            setError(err.message || t.customers.modal.addFailed);
        } finally {
            setLoading(false);
        }
    };

    const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setFormData({ ...formData, [field]: e.target.value });

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black tracking-tight">{t.customers.modal.title}</h2>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">{t.customers.modal.subtitle}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-all">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                    {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.fullName}</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={formData.name} onChange={set('name')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-black focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" placeholder={t.customers.modal.placeholders.name} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.phoneNumber}</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={formData.phone} onChange={set('phone')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-black focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" placeholder={t.customers.modal.placeholders.phone} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.email} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="email" value={formData.email} onChange={set('email')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" placeholder={t.customers.modal.placeholders.email} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.customerType}</label>
                            <select value={formData.customer_type} onChange={set('customer_type')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-black text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="INDIVIDUAL">{t.customers.modal.individual}</option>
                                <option value="ORGANIZATION">{t.customers.modal.organization}</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.customerGroup} <span className="text-gray-300">({t.common.optional})</span></label>
                            <select value={formData.customer_group_id} onChange={set('customer_group_id')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="">{t.common.none}</option>
                                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.columns.territory} <span className="text-gray-300">({t.common.optional})</span></label>
                            <select value={formData.territory_id} onChange={set('territory_id')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="">{t.common.none}</option>
                                {territories.map(ter => <option key={ter.id} value={ter.id}>{ter.parent ? `${ter.parent.name} > ` : ''}{ter.name}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.creditLimit} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="number" min="0" step="0.01" value={formData.credit_limit} onChange={set('credit_limit')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" placeholder="0.00" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.customers.modal.discountPct} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="number" min="0" max="100" step="0.01" value={formData.default_discount_pct} onChange={set('default_discount_pct')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" placeholder="0.00" />
                            </div>
                        </div>

                        <div className="col-span-2 space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.address} <span className="text-gray-300">({t.common.optional})</span></label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-4 w-4 h-4 text-gray-400" />
                                <textarea value={formData.address} onChange={set('address')} className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm min-h-[60px]" placeholder={t.customers.modal.placeholders.address} />
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button disabled={loading} type="submit" className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center transition-all bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 hover:-translate-y-0.5 disabled:opacity-50">
                            {loading ? t.customers.modal.adding : t.customers.modal.addCustomer}
                        </button>
                    </div>
                </form>
        </ModalShell>
    );
}