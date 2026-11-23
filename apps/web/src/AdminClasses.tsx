import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Power, RefreshCw, Search, X } from 'lucide-react';
import { supabase } from './lib/supabase';
import './AdminClasses.css';

type ClassItem = {
  id: string;
  code: string;
  label: string;
  cycle: string;
  display_order: number;
  is_active: boolean;
};
type ClassForm = { code: string; label: string; cycle: string; display_order: string };
const emptyForm = (): ClassForm => ({ code: '', label: '', cycle: '', display_order: '0' });

export default function AdminClasses() {
  const [items, setItems] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [cycleFilter, setCycleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editing, setEditing] = useState<ClassItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ClassForm>(emptyForm());

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('promotions')
      .select('id,code,label,cycle,display_order,is_active')
      .order('display_order')
      .order('cycle')
      .order('label');
    if (queryError) setError(queryError.message);
    else setItems((data ?? []) as ClassItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cycles = useMemo(() => Array.from(new Set(items.map(item => item.cycle))).sort(), [items]);
  const filtered = useMemo(() => items.filter(item => {
    const text = [item.code, item.label, item.cycle].join(' ').toLowerCase();
    return text.includes(search.toLowerCase())
      && (cycleFilter === 'ALL' || item.cycle === cycleFilter)
      && (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? item.is_active : !item.is_active));
  }), [items, search, cycleFilter, statusFilter]);

  function openForm(item?: ClassItem) {
    setEditing(item ?? null);
    setForm(item ? {
      code: item.code, label: item.label, cycle: item.cycle,
      display_order: String(item.display_order),
    } : emptyForm());
    setModalOpen(true);
    setError('');
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_save_class_catalogue_item', {
      p_class_id: editing?.id ?? null,
      p_code: form.code.trim(),
      p_label: form.label.trim(),
      p_cycle: form.cycle.trim(),
      p_display_order: Number(form.display_order),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(editing ? 'Classe mise à jour.' : 'Classe ajoutée au référentiel.');
    setModalOpen(false);
    setEditing(null);
    await load();
  }

  async function toggleStatus(item: ClassItem) {
    if (!supabase) return;
    const next = !item.is_active;
    if (!window.confirm(`Voulez-vous ${next ? 'activer' : 'désactiver'} la classe « ${item.label} » ?`)) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_set_class_catalogue_status', {
      p_class_id: item.id, p_is_active: next,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(next ? 'Classe activée.' : 'Classe désactivée.');
    await load();
  }

  return <section className="admin-panel classes-admin">
    <div className="classes-heading">
      <div><h3>Référentiel national des classes</h3><p>Catalogue des classes possibles, créé et administré exclusivement par l’administration centrale. Les établissements sélectionneront les classes réellement présentes dans leurs rapports.</p></div>
      <button className="admin-primary" onClick={() => openForm()}><Plus size={16}/> Nouvelle classe</button>
    </div>
    {error && <div className="classes-message error">{error}</div>}
    {notice && <div className="classes-message success">{notice}</div>}
    <div className="classes-summary">
      <div><span>Total des classes</span><b>{items.length.toLocaleString('fr-FR')}</b></div>
      <div><span>Actives</span><b>{items.filter(item => item.is_active).length.toLocaleString('fr-FR')}</b></div>
      <div><span>Inactives</span><b>{items.filter(item => !item.is_active).length.toLocaleString('fr-FR')}</b></div>
    </div>
    <div className="classes-filters">
      <label className="classes-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un code, une classe, un cycle…"/></label>
      <select value={cycleFilter} onChange={event => setCycleFilter(event.target.value)}><option value="ALL">Tous les cycles</option>{cycles.map(cycle => <option key={cycle} value={cycle}>{cycle}</option>)}</select>
      <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="ALL">Tous les statuts</option><option value="ACTIVE">Actives</option><option value="INACTIVE">Inactives</option></select>
      <button className="admin-icon-button" onClick={() => void load()} title="Actualiser"><RefreshCw size={15}/></button>
    </div>
    {loading ? <div className="admin-loading"><RefreshCw className="spin"/> Chargement du référentiel…</div>
      : filtered.length === 0 ? <div className="admin-empty">Aucune classe ne correspond aux filtres.</div>
      : <div className="admin-table-wrap"><table className="admin-table classes-table"><thead><tr><th>Code</th><th>Classe</th><th>Cycle</th><th>Ordre</th><th>Statut</th><th>Actions</th></tr></thead><tbody>
        {filtered.map(item => <tr key={item.id}>
          <td><b>{item.code}</b></td><td>{item.label}</td><td>{item.cycle}</td><td>{item.display_order}</td>
          <td><span className={item.is_active ? 'school-status active' : 'school-status inactive'}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
          <td><div className="classes-actions"><button className="admin-secondary small" onClick={() => openForm(item)}><Pencil size={13}/> Modifier</button><button className="admin-icon-button" disabled={busy} onClick={() => void toggleStatus(item)} title={item.is_active ? 'Désactiver' : 'Activer'}><Power size={14}/></button></div></td>
        </tr>)}
      </tbody></table></div>}
    {modalOpen && <div className="classes-modal-backdrop">
      <section className="classes-modal">
        <header><div><h3>{editing ? 'Modifier une classe' : 'Ajouter une classe au référentiel'}</h3><p>Cette classe sera disponible pour les rapports des établissements.</p></div><button className="admin-icon-button" onClick={() => setModalOpen(false)}><X size={16}/></button></header>
        <form onSubmit={save}>
          <div className="classes-form-grid">
            <label className="admin-field"><span>Code *</span><input value={form.code} onChange={event => setForm({...form,code:event.target.value.toUpperCase()})} maxLength={30} required placeholder="Ex. 6E"/></label>
            <label className="admin-field"><span>Libellé de la classe *</span><input value={form.label} onChange={event => setForm({...form,label:event.target.value})} maxLength={120} required placeholder="Ex. 6e"/></label>
            <label className="admin-field"><span>Cycle / niveau *</span><input value={form.cycle} onChange={event => setForm({...form,cycle:event.target.value})} maxLength={80} required placeholder="Ex. Premier cycle"/></label>
            <label className="admin-field"><span>Ordre d’affichage</span><input type="number" min="0" step="1" value={form.display_order} onChange={event => setForm({...form,display_order:event.target.value})} required/></label>
          </div>
          <div className="classes-modal-actions"><button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>Annuler</button><button type="submit" className="admin-primary" disabled={busy}><Check size={15}/> Enregistrer</button></div>
        </form>
      </section>
    </div>}
  </section>;
}
