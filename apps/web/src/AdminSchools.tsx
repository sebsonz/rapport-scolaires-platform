import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Power, RefreshCw, Search, X } from 'lucide-react';
import { supabase } from './lib/supabase';
import './AdminSchools.css';

type Department = { id: string; code: string; name: string };
type Commune = { id: string; department_id: string; code: string; name: string; is_active: boolean };
type School = {
  id: string; department_id: string; code: string; name: string; commune_id: string | null;
  arrondissement: string | null; locality: string | null; phone: string | null;
  director_name: string | null; is_active: boolean; created_at: string;
};
type SchoolForm = {
  department_id: string; code: string; name: string; commune_id: string;
  arrondissement: string; locality: string; phone: string; director_name: string;
};
const emptyForm = (departmentId = ''): SchoolForm => ({
  department_id: departmentId, code: '', name: '', commune_id: '',
  arrondissement: '', locality: '', phone: '', director_name: '',
});

export default function AdminSchools({ departments }: { departments: Department[] }) {
  const [schools, setSchools] = useState<School[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editing, setEditing] = useState<School | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<SchoolForm>(emptyForm(departments[0]?.id ?? ''));

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('schools')
      .select('id,department_id,code,name,commune_id,arrondissement,locality,phone,director_name,is_active,created_at')
      .order('name');
    const { data: communeData, error: communeError } = await supabase
      .from('communes')
      .select('id,department_id,code,name,is_active')
      .eq('is_active', true)
      .order('name');
    if (queryError || communeError) setError(queryError?.message ?? communeError?.message ?? 'Impossible de charger les communes.');
    else {
      setSchools((data ?? []) as School[]);
      setCommunes((communeData ?? []) as Commune[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const departmentById = useMemo(() => new Map(departments.map(item => [item.id, item])), [departments]);
  const communeById = useMemo(() => new Map(communes.map(item => [item.id, item])), [communes]);
  const communesForDepartment = useMemo(() => communes.filter(item => item.department_id === form.department_id), [communes, form.department_id]);
  const filtered = useMemo(() => schools.filter(school => {
    const text = [school.name, school.code, school.commune_id ? communeById.get(school.commune_id)?.name ?? '' : '', school.locality ?? ''].join(' ').toLowerCase();
    return text.includes(search.toLowerCase())
      && (departmentFilter === 'ALL' || school.department_id === departmentFilter)
      && (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? school.is_active : !school.is_active));
  }), [schools, search, departmentFilter, statusFilter, communeById]);

  function openForm(school?: School) {
    setEditing(school ?? null);
    setModalOpen(true);
    setForm(school ? {
      department_id: school.department_id, code: school.code, name: school.name,
      commune_id: school.commune_id ?? '', arrondissement: school.arrondissement ?? '',
      locality: school.locality ?? '', phone: school.phone ?? '',
      director_name: school.director_name ?? '',
    } : emptyForm(departments[0]?.id ?? ''));
    setError('');
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_save_school', {
      p_school_id: editing?.id ?? null,
      p_department_id: form.department_id,
      p_code: form.code.trim(),
      p_name: form.name.trim(),
      p_commune_id: form.commune_id,
      p_arrondissement: form.arrondissement.trim() || null,
      p_locality: form.locality.trim() || null,
      p_phone: form.phone.trim() || null,
      p_director_name: form.director_name.trim() || null,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(editing ? 'École mise à jour.' : 'École créée.');
    setEditing(null);
    setModalOpen(false);
    await load();
  }

  async function toggleStatus(school: School) {
    if (!supabase) return;
    const next = !school.is_active;
    if (!window.confirm(`Voulez-vous ${next ? 'activer' : 'désactiver'} l’établissement « ${school.name} » ?`)) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_set_school_status', {
      p_school_id: school.id, p_is_active: next,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(next ? 'Établissement activé.' : 'Établissement désactivé.');
    await load();
  }

  return <section className="admin-panel schools-admin">
    <div className="schools-heading">
      <div><h3>Référentiel des écoles</h3><p>Création et gestion exclusivement réservées à l’administration centrale.</p></div>
      <button className="admin-primary" onClick={() => openForm()} disabled={departments.length === 0}><Plus size={16}/> Nouvelle école</button>
    </div>
    {error && <div className="schools-message error">{error}</div>}
    {notice && <div className="schools-message success">{notice}</div>}
    <div className="schools-summary">
      <div><span>Total des écoles</span><b>{schools.length.toLocaleString('fr-FR')}</b></div>
      <div><span>Actives</span><b>{schools.filter(item => item.is_active).length.toLocaleString('fr-FR')}</b></div>
      <div><span>Inactives</span><b>{schools.filter(item => !item.is_active).length.toLocaleString('fr-FR')}</b></div>
    </div>
    <div className="schools-filters">
      <label className="schools-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une école, un code, une commune…"/></label>
      <select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="ALL">Tous les départements</option>{departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}</select>
      <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="ALL">Tous les statuts</option><option value="ACTIVE">Actives</option><option value="INACTIVE">Inactives</option></select>
      <button className="admin-icon-button" onClick={() => void load()} title="Actualiser"><RefreshCw size={15}/></button>
    </div>
    {loading ? <div className="admin-loading"><RefreshCw className="spin"/> Chargement des écoles…</div>
      : departments.length === 0 ? <div className="admin-empty">Créez d’abord les départements avant d’enregistrer les écoles.</div>
      : filtered.length === 0 ? <div className="admin-empty">Aucune école ne correspond aux filtres.</div>
      : <div className="admin-table-wrap"><table className="admin-table schools-table"><thead><tr><th>Établissement</th><th>Département</th><th>Commune / Localité</th><th>Statut</th><th>Actions</th></tr></thead><tbody>
        {filtered.map(school => <tr key={school.id}>
          <td><b>{school.name}</b><small>Code : {school.code}</small></td>
          <td>{departmentById.get(school.department_id)?.name ?? 'Département inconnu'}</td>
          <td>{(school.commune_id ? communeById.get(school.commune_id)?.name : null) ?? 'Commune non définie'}<small>{school.arrondissement ? school.arrondissement + ' · ' : ''}{school.locality ?? '—'}</small></td>
          <td><span className={school.is_active ? 'school-status active' : 'school-status inactive'}>{school.is_active ? 'Active' : 'Inactive'}</span></td>
          <td><div className="school-actions"><button className="admin-secondary small" onClick={() => openForm(school)}><Pencil size={13}/> Modifier</button><button className="admin-icon-button" disabled={busy} onClick={() => void toggleStatus(school)} title={school.is_active ? 'Désactiver' : 'Activer'}><Power size={14}/></button></div></td>
        </tr>)}
      </tbody></table></div>}
    {modalOpen && <div className="schools-modal-backdrop">
      <section className="schools-modal">
        <header><div><h3>{editing ? 'Modifier une école' : 'Créer une école'}</h3><p>Rattachez obligatoirement l’établissement à un département.</p></div><button className="admin-icon-button" onClick={() => { setEditing(null); setModalOpen(false); }}><X size={16}/></button></header>
        <form onSubmit={save}>
          <div className="schools-form-grid">
            <label className="admin-field wide"><span>Département *</span><select value={form.department_id} onChange={event => setForm({...form,department_id:event.target.value,commune_id:''})} required><option value="">Choisir un département</option>{departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name} ({dept.code})</option>)}</select></label>
            <label className="admin-field"><span>Code école *</span><input value={form.code} onChange={event => setForm({...form,code:event.target.value.toUpperCase()})} maxLength={30} required placeholder="Ex. ATL-001"/></label>
            <label className="admin-field"><span>Nom de l’école *</span><input value={form.name} onChange={event => setForm({...form,name:event.target.value})} maxLength={160} required placeholder="Nom officiel"/></label>
            <label className="admin-field"><span>Commune *</span><select value={form.commune_id} onChange={event => setForm({...form,commune_id:event.target.value})} required disabled={!form.department_id || communesForDepartment.length === 0}><option value="">{form.department_id ? 'Choisir une commune' : 'Choisir d’abord un département'}</option>{communesForDepartment.map(commune => <option key={commune.id} value={commune.id}>{commune.name}</option>)}</select></label>
            <label className="admin-field"><span>Arrondissement</span><input value={form.arrondissement} onChange={event => setForm({...form,arrondissement:event.target.value})} maxLength={120}/></label>
            <label className="admin-field wide"><span>Adresse / Localité</span><input value={form.locality} onChange={event => setForm({...form,locality:event.target.value})} maxLength={240}/></label>
            <label className="admin-field"><span>Téléphone</span><input value={form.phone} onChange={event => setForm({...form,phone:event.target.value})} maxLength={40}/></label>
            <label className="admin-field"><span>Directeur / Directrice</span><input value={form.director_name} onChange={event => setForm({...form,director_name:event.target.value})} maxLength={160}/></label>
          </div>
          <div className="schools-modal-actions"><button type="button" className="admin-secondary" onClick={() => { setEditing(null); setModalOpen(false); }}>Annuler</button><button type="submit" className="admin-primary" disabled={busy || departments.length === 0}><Check size={15}/> Enregistrer</button></div>
        </form>
      </section>
    </div>}
  </section>;
}
