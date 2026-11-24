import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2, Check, ChevronRight, CirclePause, FileText, ImagePlus, Mail, MapPin,
  Pencil, Phone, Plus, RefreshCw, Search, ShieldCheck, UserMinus, UserPlus, Users, X,
} from 'lucide-react';
import type { UserProfile } from './auth/AuthContext';
import { supabase } from './lib/supabase';
import './AdminOrganizations.css';

type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';
type Organization = {
  id: string;
  code: string;
  legal_name: string;
  short_name: string | null;
  logo_path: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  country: string;
  tax_identifier: string | null;
  website: string | null;
  status: OrganizationStatus;
  created_at: string;
  updated_at: string;
};
type OrganizationMembership = {
  user_id: string;
  organization_id: string;
  assigned_by: string;
  assigned_at: string;
};
type OrganizationForm = {
  legal_name: string;
  short_name: string;
  address: string;
  phone: string;
  email: string;
  country: string;
  tax_identifier: string;
  website: string;
  logo_path: string | null;
};
type Props = {
  profiles: UserProfile[];
  approvedUserIds: string[];
};

const emptyForm = (): OrganizationForm => ({
  legal_name: '', short_name: '', address: '', phone: '', email: '',
  country: 'Bénin', tax_identifier: '', website: '', logo_path: null,
});

function publicLogo(path: string | null) {
  if (!path || !supabase) return null;
  return supabase.storage.from('organization-logos').getPublicUrl(path).data.publicUrl;
}

export default function AdminOrganizations({ profiles, approvedUserIds }: Props) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrganizationStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [form, setForm] = useState<OrganizationForm>(emptyForm());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase n’est pas configuré. Vérifie les variables d’environnement de l’application.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const [organizationResult, membershipResult] = await Promise.all([
      supabase.from('organizations')
        .select('id,code,legal_name,short_name,logo_path,address,phone,email,country,tax_identifier,website,status,created_at,updated_at')
        .order('created_at', { ascending: false }),
      supabase.from('organization_memberships')
        .select('user_id,organization_id,assigned_by,assigned_at'),
    ]);
    const loadError = organizationResult.error ?? membershipResult.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      const rows = (organizationResult.data ?? []) as Organization[];
      setOrganizations(rows);
      setMemberships((membershipResult.data ?? []) as OrganizationMembership[]);
      setSelectedId(current => current && rows.some(item => item.id === current) ? current : rows[0]?.id ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredOrganizations = useMemo(() => organizations.filter(item => {
    const text = [item.code, item.legal_name, item.short_name ?? '', item.country, item.email ?? ''].join(' ').toLowerCase();
    return text.includes(search.toLowerCase())
      && (statusFilter === 'ALL' || item.status === statusFilter);
  }), [organizations, search, statusFilter]);

  const selected = organizations.find(item => item.id === selectedId) ?? null;
  const selectedMemberships = memberships.filter(item => item.organization_id === selectedId);
  const profileById = useMemo(() => new Map(profiles.map(item => [item.user_id, item])), [profiles]);
  const approvedSet = useMemo(() => new Set(approvedUserIds), [approvedUserIds]);
  const assignedUserIds = useMemo(() => new Set(memberships.map(item => item.user_id)), [memberships]);
  const availableUsers = useMemo(() => profiles
    .filter(item => approvedSet.has(item.user_id) && !assignedUserIds.has(item.user_id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr')), [profiles, approvedSet, assignedUserIds]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
    setModalOpen(true);
    setError('');
  }

  function openEdit(item: Organization) {
    setEditing(item);
    setForm({
      legal_name: item.legal_name,
      short_name: item.short_name ?? '',
      address: item.address ?? '',
      phone: item.phone ?? '',
      email: item.email ?? '',
      country: item.country ?? 'Bénin',
      tax_identifier: item.tax_identifier ?? '',
      website: item.website ?? '',
      logo_path: item.logo_path,
    });
    setLogoFile(null);
    setLogoPreview(publicLogo(item.logo_path));
    setRemoveLogo(false);
    setModalOpen(true);
    setError('');
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const accepted = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!accepted.includes(file.type)) {
      setError('Format de logo non accepté. Utilise PNG, JPG, WEBP ou SVG.');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Le logo ne doit pas dépasser 5 Mo.');
      event.target.value = '';
      return;
    }
    setError('');
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setRemoveLogo(false);
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNotice('');
    let uploadedPath: string | null = null;
    let logoPath = removeLogo ? null : form.logo_path;

    if (logoFile) {
      const extension = logoFile.name.split('.').pop()?.toLowerCase() || 'png';
      uploadedPath = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('organization-logos')
        .upload(uploadedPath, logoFile, { upsert: false, contentType: logoFile.type });
      if (uploadError) {
        setBusy(false);
        setError(uploadError.message);
        return;
      }
      logoPath = uploadedPath;
    }

    const { error: rpcError } = await supabase.rpc('admin_save_organization', {
      p_organization_id: editing?.id ?? null,
      p_legal_name: form.legal_name.trim(),
      p_short_name: form.short_name.trim() || null,
      p_address: form.address.trim() || null,
      p_phone: form.phone.trim() || null,
      p_email: form.email.trim() || null,
      p_country: form.country.trim() || 'Bénin',
      p_tax_identifier: form.tax_identifier.trim() || null,
      p_website: form.website.trim() || null,
      p_logo_path: logoPath,
    });

    if (rpcError) {
      if (uploadedPath) await supabase.storage.from('organization-logos').remove([uploadedPath]);
      setBusy(false);
      setError(rpcError.message);
      return;
    }

    setBusy(false);
    setModalOpen(false);
    setNotice(editing ? 'Organisation mise à jour.' : 'Organisation créée avec succès.');
    await load();
  }

  async function assignUser() {
    if (!supabase || !selected || !selectedUserId) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_assign_organization_user', {
      p_organization_id: selected.id,
      p_user_id: selectedUserId,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSelectedUserId('');
    setNotice('Utilisateur affecté à l’organisation.');
    await load();
  }

  async function removeUser(userId: string) {
    if (!supabase || !selected) return;
    const person = profileById.get(userId);
    if (!window.confirm(`Retirer ${person?.full_name ?? 'cet utilisateur'} de ${selected.legal_name} ? Son historique sera conservé.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_remove_organization_user', {
      p_organization_id: selected.id,
      p_user_id: userId,
      p_reason: 'Retrait effectué par l’administration centrale',
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNotice('Affectation retirée. L’historique a été conservé.');
    await load();
  }

  async function toggleStatus(item: Organization) {
    if (!supabase) return;
    const nextActive = item.status !== 'ACTIVE';
    const action = nextActive ? 'réactiver' : 'suspendre';
    const reason = window.prompt(`Motif pour ${action} « ${item.legal_name} » (facultatif) :`) ?? '';
    if (reason === null) return;
    if (!window.confirm(`Confirmer la ${action} de « ${item.legal_name} » ?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_set_organization_status', {
      p_organization_id: item.id,
      p_is_active: nextActive,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNotice(nextActive ? 'Organisation réactivée.' : 'Organisation suspendue. Les données et les affectations sont conservées.');
    await load();
  }

  return (
    <section className="admin-panel organizations-admin">
      <div className="orgs-heading">
        <div>
          <h3>Organisations / Compagnies</h3>
          <p>Identité des compagnies, affectation des utilisateurs validés et statut des organisations.</p>
        </div>
        <button className="admin-primary" onClick={openCreate}><Plus size={16}/> Nouvelle organisation</button>
      </div>

      {error && <div className="orgs-message error">{error}</div>}
      {notice && <div className="orgs-message success">{notice}</div>}

      <div className="orgs-summary">
        <article><span>Organisations</span><b>{organizations.length.toLocaleString('fr-FR')}</b></article>
        <article><span>Actives</span><b>{organizations.filter(item => item.status === 'ACTIVE').length.toLocaleString('fr-FR')}</b></article>
        <article><span>Utilisateurs affectés</span><b>{memberships.length.toLocaleString('fr-FR')}</b></article>
      </div>

      <div className="orgs-workspace">
        <aside className="orgs-list">
          <div className="orgs-list-heading"><h4>Répertoire</h4><button className="admin-icon-button" onClick={() => void load()} title="Actualiser"><RefreshCw size={15}/></button></div>
          <label className="orgs-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une compagnie…"/></label>
          <select className="orgs-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'ALL' | OrganizationStatus)}>
            <option value="ALL">Tous les statuts</option>
            <option value="ACTIVE">Actives</option>
            <option value="SUSPENDED">Suspendues</option>
          </select>
          {loading ? <div className="orgs-empty"><RefreshCw className="spin" size={17}/> Chargement…</div>
            : filteredOrganizations.length === 0 ? <div className="orgs-empty">Aucune organisation trouvée.</div>
            : filteredOrganizations.map(item => (
              <button type="button" className={selectedId === item.id ? 'orgs-list-item selected' : 'orgs-list-item'} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className="orgs-avatar">{publicLogo(item.logo_path) ? <img src={publicLogo(item.logo_path)!} alt="" /> : <Building2 size={20}/>}</span>
                <span className="orgs-list-copy"><b>{item.legal_name}</b><small>{item.code} · {memberships.filter(member => member.organization_id === item.id).length} membre(s)</small></span>
                <i className={item.status === 'ACTIVE' ? 'orgs-status-dot active' : 'orgs-status-dot suspended'}/>
              </button>
            ))}
        </aside>

        <div className="orgs-detail">
          {!selected ? (
            <div className="orgs-empty large"><Building2 size={32}/><b>Aucune organisation sélectionnée</b><span>Crée une organisation pour commencer la gestion des compagnies.</span><button className="admin-primary" onClick={openCreate}><Plus size={15}/> Créer une organisation</button></div>
          ) : (
            <>
              <div className="orgs-detail-top">
                <div className="orgs-identity">
                  <div className="orgs-logo">{publicLogo(selected.logo_path) ? <img src={publicLogo(selected.logo_path)!} alt={selected.legal_name}/> : <Building2 size={30}/>}</div>
                  <div><span className="orgs-code">{selected.code}</span><h3>{selected.legal_name}</h3><p>{selected.short_name || 'Organisation'} · {selected.country}</p></div>
                </div>
                <div className="orgs-detail-actions">
                  <span className={selected.status === 'ACTIVE' ? 'orgs-status-badge active' : 'orgs-status-badge suspended'}>{selected.status === 'ACTIVE' ? 'Active' : 'Suspendue'}</span>
                  <button className="admin-secondary small" onClick={() => openEdit(selected)} disabled={busy}><Pencil size={14}/> Modifier</button>
                  <button className={selected.status === 'ACTIVE' ? 'orgs-danger-button' : 'orgs-reactivate-button'} onClick={() => void toggleStatus(selected)} disabled={busy}>
                    {selected.status === 'ACTIVE' ? <><CirclePause size={14}/> Suspendre</> : <><Check size={14}/> Réactiver</>}
                  </button>
                </div>
              </div>

              <div className="orgs-info-grid">
                <div><MapPin/><span>Adresse</span><b>{selected.address || 'Non renseignée'}</b></div>
                <div><Phone/><span>Téléphone</span><b>{selected.phone || 'Non renseigné'}</b></div>
                <div><Mail/><span>E-mail</span><b>{selected.email || 'Non renseigné'}</b></div>
                <div><FileText/><span>IFU / Identifiant fiscal</span><b>{selected.tax_identifier || 'Non renseigné'}</b></div>
              </div>

              <div className="orgs-members">
                <div className="orgs-section-heading"><div><h4>Utilisateurs associés</h4><p>Seuls les comptes validés et sans organisation sont proposés.</p></div><span>{selectedMemberships.length} membre(s)</span></div>
                <div className="orgs-assign-row">
                  <select value={selectedUserId} onChange={event => setSelectedUserId(event.target.value)} disabled={busy || selected.status !== 'ACTIVE'}>
                    <option value="">Sélectionner un utilisateur validé…</option>
                    {availableUsers.map(user => <option key={user.user_id} value={user.user_id}>{user.full_name} · {user.email}</option>)}
                  </select>
                  <button className="admin-primary" onClick={() => void assignUser()} disabled={busy || selected.status !== 'ACTIVE' || !selectedUserId}><UserPlus size={15}/> Affecter</button>
                </div>
                {selectedMemberships.length === 0 ? <div className="orgs-empty">Aucun utilisateur associé à cette organisation.</div>
                  : selectedMemberships.map(member => {
                    const person = profileById.get(member.user_id);
                    return <div className="orgs-member-row" key={member.user_id}>
                      <span className="orgs-member-avatar">{(person?.full_name ?? '?').slice(0, 1).toUpperCase()}</span>
                      <div><b>{person?.full_name ?? 'Utilisateur inconnu'}</b><small>{person?.email ?? member.user_id} · Affecté le {new Date(member.assigned_at).toLocaleDateString('fr-FR')}</small></div>
                      <button className="orgs-remove-button" onClick={() => void removeUser(member.user_id)} disabled={busy} title="Retirer de l’organisation"><UserMinus size={15}/></button>
                    </div>;
                  })}
              </div>

              <div className="orgs-footer-note"><ShieldCheck size={15}/> Les bordereaux conserveront un instantané du logo et des coordonnées de cette compagnie au moment de leur création.</div>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setModalOpen(false); }}>
          <section className="admin-modal orgs-modal">
            <header><h3>{editing ? 'Modifier l’organisation' : 'Créer une organisation'}</h3><button className="admin-icon-button" onClick={() => setModalOpen(false)} disabled={busy}><X size={17}/></button></header>
            <form className="admin-modal-body orgs-form" onSubmit={saveOrganization}>
              <div className="orgs-logo-upload">
                <div className="orgs-logo-preview">{logoPreview ? <img src={logoPreview} alt="Aperçu du logo"/> : <ImagePlus size={27}/>}</div>
                <div><b>Logo de la compagnie</b><small>PNG, JPG, WEBP ou SVG · 5 Mo maximum</small><label className="orgs-file-button">Choisir un fichier<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoChange} disabled={busy}/></label>{form.logo_path && !removeLogo && !logoFile && <button type="button" className="orgs-link-button" onClick={() => { setRemoveLogo(true); setLogoPreview(null); }}>Retirer le logo</button>}{removeLogo && <button type="button" className="orgs-link-button" onClick={() => { setRemoveLogo(false); setLogoPreview(publicLogo(form.logo_path)); }}>Conserver le logo actuel</button>}</div>
              </div>
              <div className="orgs-form-grid">
                <label className="admin-field"><span>Nom officiel *</span><input value={form.legal_name} onChange={event => setForm(current => ({ ...current, legal_name: event.target.value }))} maxLength={180} required placeholder="Nom complet de la compagnie"/></label>
                <label className="admin-field"><span>Sigle / nom court</span><input value={form.short_name} onChange={event => setForm(current => ({ ...current, short_name: event.target.value }))} maxLength={60} placeholder="Ex. : CE"/></label>
                <label className="admin-field orgs-span-2"><span>Adresse</span><input value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} maxLength={300} placeholder="Adresse administrative"/></label>
                <label className="admin-field"><span>Téléphone</span><input value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} maxLength={40} placeholder="+229…"/></label>
                <label className="admin-field"><span>E-mail professionnel</span><input type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} maxLength={254} placeholder="contact@compagnie.bj"/></label>
                <label className="admin-field"><span>Pays *</span><input value={form.country} onChange={event => setForm(current => ({ ...current, country: event.target.value }))} maxLength={100} required/></label>
                <label className="admin-field"><span>IFU / Identifiant fiscal</span><input value={form.tax_identifier} onChange={event => setForm(current => ({ ...current, tax_identifier: event.target.value }))} maxLength={80} placeholder="Identifiant fiscal"/></label>
                <label className="admin-field orgs-span-2"><span>Site web</span><input type="url" value={form.website} onChange={event => setForm(current => ({ ...current, website: event.target.value }))} maxLength={300} placeholder="https://…"/></label>
              </div>
              <div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={() => setModalOpen(false)} disabled={busy}>Annuler</button><button type="submit" className="admin-primary" disabled={busy || form.legal_name.trim().length < 2}>{busy ? <><RefreshCw className="spin" size={15}/> Enregistrement…</> : <><Check size={15}/> {editing ? 'Enregistrer les modifications' : 'Créer l’organisation'}</>}</button></div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
