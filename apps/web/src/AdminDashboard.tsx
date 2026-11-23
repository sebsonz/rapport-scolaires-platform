import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertCircle, BookOpen, Building2, Check, CheckCircle2,
  ChevronRight, ClipboardCheck, Clock3, GraduationCap, LayoutDashboard, LogOut,
  Plus, RefreshCw, Search, ShieldCheck, Users, X, Pencil, History,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import type { UserProfile } from './auth/AuthContext';
import AdminSchools from './AdminSchools';
import AdminClasses from './AdminClasses';

type Role = 'CATEGORY_1' | 'CATEGORY_2';
type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type Department = { id: string; code: string; name: string; created_at: string };
type Membership = { id: string; user_id: string; department_id: string | null; role: 'CENTRAL_ADMIN' | Role };
type AccessRequest = { id: string; user_id: string; status: RequestStatus; requested_at: string; reviewed_at: string | null; review_note: string | null };
type AuditEvent = { id: number; actor_user_id: string | null; department_id: string | null; event_type: string; entity_table: string; record_id: string | null; details: Record<string, unknown>; created_at: string };
type Assignment = { department_id: string; role: Role };
type Tab = 'overview' | 'requests' | 'users' | 'departments' | 'schools' | 'classes' | 'audit';

const labels: Record<Tab, string> = {
  overview: 'Vue générale',
  requests: 'Demandes d’accès',
  users: 'Utilisateurs',
  departments: 'Départements',
  schools: 'Écoles',
  classes: 'Classes',
  audit: 'Journal d’audit',
};

export default function AdminDashboard({ profile, onSignOut }: { profile: UserProfile | null; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [overview, setOverview] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [requestAssignments, setRequestAssignments] = useState<Assignment[]>([{ department_id: '', role: 'CATEGORY_1' }]);
  const [reviewNote, setReviewNote] = useState('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userAssignments, setUserAssignments] = useState<Assignment[]>([]);
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departmentCode, setDepartmentCode] = useState('');
  const [departmentName, setDepartmentName] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const [overviewResult, deptResult, profileResult, requestResult, membershipResult, auditResult] = await Promise.all([
      supabase.rpc('admin_get_overview'),
      supabase.from('departments').select('id,code,name,created_at').order('name'),
      supabase.from('user_profiles').select('user_id,full_name,email').order('full_name'),
      supabase.from('access_requests').select('id,user_id,status,requested_at,reviewed_at,review_note').order('requested_at', { ascending: false }),
      supabase.from('school_memberships').select('id,user_id,department_id,role'),
      supabase.from('audit_events').select('id,actor_user_id,department_id,event_type,entity_table,record_id,details,created_at').order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = overviewResult.error ?? deptResult.error ?? profileResult.error ?? requestResult.error ?? membershipResult.error ?? auditResult.error;
    if (firstError) setError(firstError.message);
    setOverview((overviewResult.data ?? {}) as Record<string, unknown>);
    setDepartments((deptResult.data ?? []) as Department[]);
    setProfiles((profileResult.data ?? []) as UserProfile[]);
    setRequests((requestResult.data ?? []) as AccessRequest[]);
    setMemberships((membershipResult.data ?? []) as Membership[]);
    setAudit((auditResult.data ?? []) as AuditEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const profileById = useMemo(() => new Map(profiles.map(item => [item.user_id, item])), [profiles]);
  const departmentById = useMemo(() => new Map(departments.map(item => [item.id, item])), [departments]);
  const filteredProfiles = useMemo(() => profiles.filter(item =>
    (item.full_name + ' ' + item.email).toLowerCase().includes(search.toLowerCase())
  ), [profiles, search]);
  const pendingRequests = requests.filter(item => item.status === 'PENDING');

  function openRequest(request: AccessRequest) {
    setSelectedRequest(request.user_id);
    setRequestAssignments([{ department_id: departments[0]?.id ?? '', role: 'CATEGORY_1' }]);
    setReviewNote('');
  }

  async function reviewRequest(decision: 'APPROVED' | 'REJECTED') {
    if (!supabase || !selectedRequest) return;
    if (decision === 'APPROVED' && (requestAssignments.length === 0 || requestAssignments.some(item => !item.department_id))) {
      setError('Attribue au moins un département et un rôle valide.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_review_access_request', {
      p_user_id: selectedRequest,
      p_decision: decision,
      p_review_note: reviewNote,
      p_assignments: decision === 'APPROVED' ? requestAssignments : [],
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(decision === 'APPROVED' ? 'Demande approuvée et affectations enregistrées.' : 'Demande rejetée.');
    setSelectedRequest(null);
    await load();
  }

  function editUser(userId: string) {
    const current = memberships.filter(item => item.user_id === userId && item.role !== 'CENTRAL_ADMIN');
    setEditingUser(userId);
    setUserAssignments(current.map(item => ({ department_id: item.department_id ?? '', role: item.role as Role })));
  }

  async function saveUserAssignments() {
    if (!supabase || !editingUser) return;
    if (userAssignments.some(item => !item.department_id)) { setError('Chaque affectation doit avoir un département.'); return; }
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_set_user_assignments', {
      p_user_id: editingUser,
      p_assignments: userAssignments,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice('Affectations utilisateur mises à jour.');
    setEditingUser(null);
    await load();
  }

  function openDepartment(department?: Department) {
    setDepartmentModalOpen(true);
    setDepartmentId(department?.id ?? null);
    setDepartmentCode(department?.code ?? '');
    setDepartmentName(department?.name ?? '');
  }

  async function saveDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_save_department', {
      p_department_id: departmentId,
      p_code: departmentCode,
      p_name: departmentName,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(departmentId ? 'Département mis à jour.' : 'Département créé.');
    setDepartmentModalOpen(false); setDepartmentId(null); setDepartmentCode(''); setDepartmentName('');
    await load();
  }

  const metric = (key: string) => Number(overview[key] ?? 0).toLocaleString('fr-FR');

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><div className="admin-brand-mark"><GraduationCap/></div><div><b>Rapports Scolaires</b><small>ADMINISTRATION CENTRALE</small></div></div>
        <div className="admin-side-caption">ESPACE SUPER ADMIN</div>
        <nav className="admin-nav">
          {([
            ['overview', LayoutDashboard, 'Vue générale'],
            ['requests', ClipboardCheck, 'Demandes d’accès'],
            ['users', Users, 'Utilisateurs'],
            ['departments', Building2, 'Départements'],
            ['schools', GraduationCap, 'Écoles'],
            ['classes', BookOpen, 'Classes'],
            ['audit', History, 'Journal d’audit'],
          ] as const).map(([key, Icon, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17}/><span>{label}</span>{key === 'requests' && pendingRequests.length > 0 && <em>{pendingRequests.length}</em>}</button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-profile"><div className="admin-avatar">{(profile?.full_name ?? 'AD').slice(0,2).toUpperCase()}</div><div><b>{profile?.full_name ?? 'Administrateur'}</b><small>Administrateur central</small></div></div>
          <button className="admin-logout" onClick={onSignOut}><LogOut size={16}/> Se déconnecter</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div><span>PLATEFORME / ADMINISTRATION</span><h1>{labels[tab]}</h1></div>
          <div className="admin-top-actions"><span className="admin-secure"><ShieldCheck size={15}/> Session sécurisée</span><button className="admin-icon-button" onClick={() => void load()} title="Actualiser"><RefreshCw size={16}/></button></div>
        </header>
        <div className="admin-content">
          {error && <div className="admin-alert error"><AlertCircle size={17}/>{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
          {notice && <div className="admin-alert success"><CheckCircle2 size={17}/>{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
          {loading ? <div className="admin-loading"><RefreshCw className="spin"/> Chargement des données administratives…</div> : null}

          {!loading && tab === 'overview' && <>
            <div className="admin-welcome"><div><span>ANNÉE SCOLAIRE 2026 — 2027</span><h2>Bonjour {profile?.full_name ?? 'Administrateur'} 👋</h2><p>Pilotez les accès, les utilisateurs et l’organisation des départements depuis cet espace central.</p></div><div className="admin-welcome-icon"><ShieldCheck size={34}/></div></div>
            <div className="admin-metrics">
              <Metric icon={<Users/>} label="Utilisateurs inscrits" value={metric('users_total')} hint="Comptes enregistrés"/>
              <Metric icon={<Clock3/>} label="Demandes en attente" value={metric('requests_pending')} hint="À examiner" emphasis/>
              <Metric icon={<Building2/>} label="Départements" value={metric('departments_total')} hint="Structures créées"/>
              <Metric icon={<ShieldCheck/>} label="Affectations actives" value={metric('memberships_total')} hint="Rôles départementaux"/>
            </div>
            <div className="admin-overview-grid">
              <section className="admin-panel"><div className="admin-panel-head"><div><h3>Demandes récentes</h3><p>Dernières inscriptions reçues</p></div><button className="admin-text-button" onClick={() => setTab('requests')}>Tout voir <ChevronRight size={15}/></button></div>
                {requests.slice(0,6).map(item => <div className="admin-list-row" key={item.id}><div className="admin-user-avatar">{(profileById.get(item.user_id)?.full_name ?? '?').slice(0,1).toUpperCase()}</div><div className="admin-list-main"><b>{profileById.get(item.user_id)?.full_name ?? 'Utilisateur'}</b><small>{profileById.get(item.user_id)?.email ?? item.user_id}</small></div><Status status={item.status}/>{item.status === 'PENDING' && <button className="admin-row-action" onClick={() => { setTab('requests'); openRequest(item); }}>Examiner</button>}</div>)}
                {requests.length === 0 && <Empty text="Aucune demande enregistrée."/>}
              </section>
              <section className="admin-panel"><div className="admin-panel-head"><div><h3>Répartition des accès</h3><p>État des demandes</p></div><Activity size={19}/></div>
                <div className="admin-status-summary"><div><span className="dot pending-dot"/><span>En attente</span><b>{metric('requests_pending')}</b></div><div><span className="dot approved-dot"/><span>Approuvées</span><b>{metric('requests_approved')}</b></div><div><span className="dot rejected-dot"/><span>Rejetées</span><b>{metric('requests_rejected')}</b></div></div>
                <div className="admin-dept-preview"><h4>Départements enregistrés</h4>{departments.slice(0,5).map(dept => <div key={dept.id}><span>{dept.name}</span><small>{dept.code}</small></div>)}{departments.length === 0 && <Empty text="Créez votre premier département pour commencer."/>}</div>
              </section>
            </div>
          </>}

          {!loading && tab === 'requests' && <section className="admin-panel">
            <div className="admin-panel-head"><div><h3>Demandes d’accès</h3><p>Vérifiez chaque demande et attribuez les rôles départementaux avant approbation.</p></div><span className="admin-count">{pendingRequests.length} en attente</span></div>
            {requests.map(item => <div className="admin-request-row" key={item.id}><div className="admin-user-avatar large">{(profileById.get(item.user_id)?.full_name ?? '?').slice(0,1).toUpperCase()}</div><div className="admin-list-main"><b>{profileById.get(item.user_id)?.full_name ?? 'Utilisateur inconnu'}</b><small>{profileById.get(item.user_id)?.email ?? item.user_id}</small><small>Inscription : {new Date(item.requested_at).toLocaleString('fr-FR')}</small></div><Status status={item.status}/>{item.status === 'PENDING' && <button className="admin-primary small" onClick={() => openRequest(item)}>Examiner</button>}</div>)}
            {requests.length === 0 && <Empty text="Aucune demande d’accès pour le moment."/>}
          </section>}

          {!loading && tab === 'users' && <section className="admin-panel">
            <div className="admin-panel-head"><div><h3>Utilisateurs et affectations</h3><p>Un utilisateur peut posséder plusieurs rôles dans plusieurs départements.</p></div><div className="admin-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un utilisateur"/></div></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utilisateur</th><th>État du compte</th><th>Départements et rôles</th><th>Action</th></tr></thead><tbody>
              {filteredProfiles.map(user => {
                const req = requests.find(item => item.user_id === user.user_id);
                const userMemberships = memberships.filter(item => item.user_id === user.user_id);
                const groupedMemberships = new Map<string, { departmentName: string; roles: string[]; central: boolean }>();
                userMemberships.forEach(membership => {
                  const key = membership.role === 'CENTRAL_ADMIN' ? 'central' : membership.department_id ?? 'unknown';
                  const group = groupedMemberships.get(key) ?? {
                    departmentName: membership.role === 'CENTRAL_ADMIN'
                      ? 'Administrateur central'
                      : departmentById.get(membership.department_id ?? '')?.name ?? 'Département',
                    roles: [],
                    central: membership.role === 'CENTRAL_ADMIN',
                  };
                  const roleLabel = membership.role === 'CATEGORY_1' ? 'Catégorie 1'
                    : membership.role === 'CATEGORY_2' ? 'Catégorie 2' : 'Central';
                  if (!group.roles.includes(roleLabel)) group.roles.push(roleLabel);
                  groupedMemberships.set(key, group);
                });
                return <tr key={user.user_id}><td><b>{user.full_name}</b><small>{user.email}</small></td><td><Status status={req?.status ?? 'PENDING'}/></td><td>{userMemberships.length === 0 ? <span className="muted">Aucune affectation</span> : <div className="admin-role-list">{Array.from(groupedMemberships.entries()).map(([key, group]) => <span key={key}>{group.departmentName} · {group.roles.join(' · ')}</span>)}</div>}</td><td>{!userMemberships.some(m => m.role === 'CENTRAL_ADMIN') && req?.status === 'APPROVED' && <button className="admin-secondary small" onClick={() => editUser(user.user_id)}><Pencil size={14}/> Gérer</button>}</td></tr>;
              })}
            </tbody></table>{filteredProfiles.length === 0 && <Empty text="Aucun utilisateur correspondant."/>}</div>
          </section>}

          {!loading && tab === 'departments' && <section className="admin-panel">
            <div className="admin-panel-head"><div><h3>Départements</h3><p>Créez et maintenez les structures de la plateforme.</p></div><button className="admin-primary" onClick={() => openDepartment()}><Plus size={16}/> Nouveau département</button></div>
            <div className="admin-department-grid">{departments.map(dept => <article className="admin-department-card" key={dept.id}><div className="admin-dept-icon"><Building2/></div><div><b>{dept.name}</b><small>Code : {dept.code}</small></div><button className="admin-icon-button" onClick={() => openDepartment(dept)} title="Modifier"><Pencil size={15}/></button></article>)}</div>
            {departments.length === 0 && <Empty text="Aucun département créé. Ajoutez le premier département."/>}
          </section>}

          {!loading && tab === 'schools' && <AdminSchools departments={departments}/>}
          {!loading && tab === 'classes' && <AdminClasses/>}

          {!loading && tab === 'audit' && <section className="admin-panel">
            <div className="admin-panel-head"><div><h3>Journal d’audit</h3><p>Historique des opérations administratives récentes (100 dernières entrées).</p></div><span className="admin-count">{audit.length} événements</span></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Date</th><th>Acteur</th><th>Événement</th><th>Objet</th><th>Détails</th></tr></thead><tbody>
              {audit.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('fr-FR')}</td><td>{item.actor_user_id ? profileById.get(item.actor_user_id)?.full_name ?? item.actor_user_id.slice(0,8) : 'Système'}</td><td><b>{item.event_type}</b></td><td>{item.entity_table}</td><td><code>{JSON.stringify(item.details ?? {})}</code></td></tr>)}
            </tbody></table>{audit.length === 0 && <Empty text="Aucun événement d’audit."/>}</div>
          </section>}
        </div>
      </main>

      {selectedRequest && <Modal title="Examiner la demande d’accès" onClose={() => setSelectedRequest(null)}>
        <div className="admin-modal-user"><b>{profileById.get(selectedRequest)?.full_name}</b><span>{profileById.get(selectedRequest)?.email}</span></div>
        <p className="admin-form-help">Attribuez un ou plusieurs couples département/rôle. Les deux catégories peuvent être cumulées dans un même département.</p>
        <AssignmentEditor assignments={requestAssignments} departments={departments} onChange={setRequestAssignments}/>
        <label className="admin-field"><span>Note administrative (facultative)</span><textarea value={reviewNote} onChange={event => setReviewNote(event.target.value)} rows={2} placeholder="Motif ou consignes pour l’utilisateur"/></label>
        <div className="admin-modal-actions"><button className="admin-secondary" onClick={() => void reviewRequest('REJECTED')} disabled={busy}>Rejeter</button><button className="admin-primary" onClick={() => void reviewRequest('APPROVED')} disabled={busy || departments.length === 0}><Check size={16}/> Approuver et attribuer</button></div>
      </Modal>}

      {editingUser && <Modal title="Gérer les affectations" onClose={() => setEditingUser(null)}>
        <div className="admin-modal-user"><b>{profileById.get(editingUser)?.full_name}</b><span>{profileById.get(editingUser)?.email}</span></div>
        <p className="admin-form-help">Remplacez les affectations existantes. Les rôles centraux sont protégés et ne peuvent pas être attribués ici.</p>
        <AssignmentEditor assignments={userAssignments} departments={departments} onChange={setUserAssignments}/>
        <div className="admin-modal-actions"><button className="admin-secondary" onClick={() => setEditingUser(null)}>Annuler</button><button className="admin-primary" onClick={() => void saveUserAssignments()} disabled={busy}><Check size={16}/> Enregistrer</button></div>
      </Modal>}

      {departmentModalOpen && tab === 'departments' && <Modal title={departmentId ? 'Modifier le département' : 'Créer un département'} onClose={() => { setDepartmentModalOpen(false); setDepartmentId(null); setDepartmentCode(''); setDepartmentName(''); }}>
        <form onSubmit={saveDepartment}><label className="admin-field"><span>Code du département</span><input value={departmentCode} onChange={event => setDepartmentCode(event.target.value.toUpperCase())} maxLength={30} required placeholder="Ex. ATL"/></label><label className="admin-field"><span>Nom du département</span><input value={departmentName} onChange={event => setDepartmentName(event.target.value)} maxLength={120} required placeholder="Ex. Atlantique"/></label><div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={() => { setDepartmentModalOpen(false); setDepartmentId(null); setDepartmentCode(''); setDepartmentName(''); }}>Annuler</button><button type="submit" className="admin-primary" disabled={busy}><Check size={16}/> Enregistrer</button></div></form>
      </Modal>}
    </div>
  );
}

function Metric({ icon, label, value, hint, emphasis = false }: { icon: ReactNode; label: string; value: string; hint: string; emphasis?: boolean }) {
  return <article className={emphasis ? 'admin-metric emphasis' : 'admin-metric'}><div className="admin-metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{hint}</small></article>;
}

function Status({ status }: { status: RequestStatus }) {
  const text = status === 'PENDING' ? 'En attente' : status === 'APPROVED' ? 'Approuvé' : 'Rejeté';
  return <span className={'admin-status ' + status.toLowerCase()}><i/>{text}</span>;
}

function Empty({ text }: { text: string }) { return <div className="admin-empty">{text}</div>; }

function AssignmentEditor({ assignments, departments, onChange }: { assignments: Assignment[]; departments: Department[]; onChange: (items: Assignment[]) => void }) {
  return <div className="admin-assignment-editor">
    {assignments.map((item, index) => <div className="admin-assignment-row" key={index}>
      <select value={item.department_id} onChange={event => onChange(assignments.map((row, i) => i === index ? { ...row, department_id: event.target.value } : row))} required>
        <option value="">Choisir un département</option>{departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name} ({dept.code})</option>)}
      </select>
      <select value={item.role} onChange={event => onChange(assignments.map((row, i) => i === index ? { ...row, role: event.target.value as Role } : row))}>
        <option value="CATEGORY_1">Catégorie 1</option><option value="CATEGORY_2">Catégorie 2</option>
      </select>
      <button type="button" className="admin-icon-button danger" onClick={() => onChange(assignments.filter((_, i) => i !== index))} title="Retirer"><X size={15}/></button>
    </div>)}
    <button type="button" className="admin-add-assignment" onClick={() => onChange([...assignments, { department_id: '', role: 'CATEGORY_1' }])}><Plus size={15}/> Ajouter une affectation</button>
  </div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="admin-modal"><header><h3>{title}</h3><button className="admin-icon-button" onClick={onClose}><X size={17}/></button></header><div className="admin-modal-body">{children}</div></section></div>;
}
