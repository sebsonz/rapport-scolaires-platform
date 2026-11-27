import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity, BookOpen, Building2, CheckCircle2, ClipboardList, GraduationCap,
  History, LogOut, PackageCheck, RefreshCw, ShieldCheck, Truck, Users,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import './SchoolReportDashboard.css';
import SchoolPedagogicalClasses from './SchoolPedagogicalClasses';
import DeliverySlips from './DeliverySlips';
import AutomaticDeliverySlips from './AutomaticDeliverySlips';
const SchoolCorrectionReasons = lazy(() => import('./features/school-correction-reasons/SchoolCorrectionReasons'));

type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };
type Department = { id: string; code: string; name: string };
type Commune = { id: string; department_id: string; code: string; name: string };
type School = { id: string; department_id: string; code: string; name: string; commune_id: string | null };
type Year = { id: string; code: string; label: string };
type Promotion = { id: string; code: string; label: string; cycle: string };
type Group = { id: string; school_id: string; school_year_id: string; promotion_id: string; group_code: string; is_active: boolean };
type Report = { id: string; pedagogical_group_id: string; report_data: Record<string, unknown> };
type Operation = { id: string; pedagogical_group_id: string; operation_type: string; quantity: number; created_at: string; note: string | null };
type DeliveryInitialCorrection = { id: string; school_report_id: string; quantity: number; created_at: string; note: string | null };

const operationLabels: Record<string, string> = {
  ENROLLMENT_RATISSAGE: 'Ratissage',
  ENROLLMENT_CORRECTION: 'Correction',
  DELIVERY_INITIAL: 'Livraison initiale',
  DELIVERY_RATISSAGE: 'Livraison ratissage',
  DELIVERY_CORRECTION_FIRST_ISSUE: 'Livraison correction',
  DELIVERY_REPRINT: 'Réimpression',
};

export default function SchoolReportDashboard({ memberships, onSignOut, onBackToAdmin }: {
  memberships: Membership[];
  onSignOut: () => void;
  onBackToAdmin?: () => void;
}) {
  const [schools, setSchools] = useState<School[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedCommune, setSelectedCommune] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const schoolIdRef = useRef('');
  const loadRequestRef = useRef(0);
  const [year, setYear] = useState<Year | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [deliveryInitialCorrections, setDeliveryInitialCorrections] = useState<DeliveryInitialCorrection[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [entryType, setEntryType] = useState('INITIAL');
  const [selectedEntryCategory, setSelectedEntryCategory] = useState<'CATEGORY_1' | 'CATEGORY_2'>('CATEGORY_1');
  const [quantity, setQuantity] = useState('');
  const [capacity, setCapacity] = useState('');
  const [initialEnrollment, setInitialEnrollment] = useState('');
  const [editingInitial, setEditingInitial] = useState(false);
  const [editingInitialDelivery, setEditingInitialDelivery] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedSchoolForRole = schools.find(item => item.id === schoolId);
  const scopedRoles = new Set(memberships
    .filter(item => item.role === 'CENTRAL_ADMIN' || item.department_id === selectedSchoolForRole?.department_id)
    .map(item => item.role));
  const canEnrollment = scopedRoles.has('CATEGORY_1') || scopedRoles.has('CENTRAL_ADMIN');
  const canDelivery = scopedRoles.has('CATEGORY_2') || scopedRoles.has('CENTRAL_ADMIN');
  const canManageCorrectionReasons = canEnrollment;
  const canReadCorrectionReasons = canManageCorrectionReasons || canDelivery;

  const load = useCallback(async (keepSchool = true, requestedSchoolId?: string) => {
    if (!supabase) { setError('La connexion Supabase est indisponible.'); setLoading(false); return; }
    const requestId = ++loadRequestRef.current;
    setLoading(true); setError('');
    const [catalogResult, yearResult, promotionResult] = await Promise.all([
      supabase.rpc('get_school_location_filter_catalog'),
      supabase.from('school_years').select('id,code,label').eq('is_active', true).order('starts_on', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('promotions').select('id,code,label,cycle').eq('is_active', true).order('display_order').order('label'),
    ]);
    if (requestId !== loadRequestRef.current) return;
    const firstError = catalogResult.error ?? yearResult.error ?? promotionResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const catalogRows = (catalogResult.data ?? []) as Array<{
      department_id: string; department_code: string; department_name: string;
      commune_id: string | null; commune_code: string | null; commune_name: string | null;
      school_id: string; school_code: string; school_name: string;
    }>;
    const departmentMap = new Map<string, Department>();
    const communeMap = new Map<string, Commune>();
    const schoolMap = new Map<string, School>();
    for (const row of catalogRows) {
      departmentMap.set(row.department_id, {
        id: row.department_id, code: row.department_code, name: row.department_name,
      });
      if (row.commune_id && row.commune_code && row.commune_name) {
        communeMap.set(row.commune_id, {
          id: row.commune_id, department_id: row.department_id,
          code: row.commune_code, name: row.commune_name,
        });
      }
      schoolMap.set(row.school_id, {
        id: row.school_id, department_id: row.department_id,
        code: row.school_code, name: row.school_name, commune_id: row.commune_id,
      });
    }
    const visibleSchools = [...schoolMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const activeYear = yearResult.data as Year | null;
    if (requestId !== loadRequestRef.current) return;
    setSchools(visibleSchools);
    setCommunes([...communeMap.values()]);
    setDepartments([...departmentMap.values()]);
    setYear(activeYear);
    setPromotions((promotionResult.data ?? []) as Promotion[]);
    const preferredSchoolId = requestedSchoolId ?? schoolIdRef.current;
    const currentSchool = keepSchool && visibleSchools.some(s => s.id === preferredSchoolId)
      ? preferredSchoolId : (requestedSchoolId === '' ? '' : (visibleSchools[0]?.id ?? ''));
    schoolIdRef.current = currentSchool;
    setSchoolId(currentSchool);
    if (!currentSchool || !activeYear) {
      setGroups([]); setReports([]); setOperations([]); setDeliveryInitialCorrections([]); setLoading(false); return;
    }
    const [groupResult, reportResult] = await Promise.all([
      supabase.from('pedagogical_groups').select('id,school_id,school_year_id,promotion_id,group_code,is_active')
        .eq('school_id', currentSchool).eq('school_year_id', activeYear.id).eq('is_active', true).order('created_at'),
      supabase.from('school_reports').select('id,pedagogical_group_id,report_data')
        .eq('school_id', currentSchool).eq('school_year_id', activeYear.id),
    ]);
    if (requestId !== loadRequestRef.current) return;
    if (groupResult.error || reportResult.error) {
      setError(groupResult.error?.message ?? reportResult.error?.message ?? 'Impossible de charger les rapports.');
      setLoading(false); return;
    }
    const nextGroups = (groupResult.data ?? []) as Group[];
    const nextReports = (reportResult.data ?? []) as Report[];
    setGroups(nextGroups); setReports(nextReports);
    if (nextGroups.length) {
      const { data, error: operationError } = await supabase.from('school_report_operations')
        .select('id,pedagogical_group_id,operation_type,quantity,created_at,note')
        .in('pedagogical_group_id', nextGroups.map(g => g.id)).order('created_at', { ascending: false });
      if (requestId !== loadRequestRef.current) return;
      if (operationError) setError(operationError.message);
      setOperations((data ?? []) as Operation[]);
      if (nextReports.length) {
        const { data: correctionData, error: correctionError } = await supabase
          .from('school_report_delivery_initial_corrections')
          .select('id,school_report_id,quantity,created_at,note')
          .in('school_report_id', nextReports.map(report => report.id))
          .order('created_at', { ascending: false });
        if (requestId !== loadRequestRef.current) return;
        if (correctionError) setError(correctionError.message);
        setDeliveryInitialCorrections((correctionData ?? []) as DeliveryInitialCorrection[]);
      } else setDeliveryInitialCorrections([]);
    } else { setOperations([]); setDeliveryInitialCorrections([]); }
    setSelectedGroup(current => nextGroups.some(g => g.id === current) ? current : (nextGroups[0]?.id ?? ''));
    setLoading(false);
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const school = schools.find(item => item.id === schoolId);
  const filteredSchools = useMemo(() => schools.filter(item =>
    (!selectedDepartmentId || item.department_id === selectedDepartmentId)
    && (!selectedCommune || item.commune_id === selectedCommune)
  ), [schools, selectedDepartmentId, selectedCommune]);
  const availableCommunes = useMemo(() => communes.filter(commune =>
    (!selectedDepartmentId || commune.department_id === selectedDepartmentId)
    && schools.some(school => school.department_id === commune.department_id && school.commune_id === commune.id)
  ).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  [communes, schools, selectedDepartmentId]);
  const availableDepartments = useMemo(() => departments.filter(department =>
    schools.some(school => school.department_id === department.id)
  ).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  [departments, schools]);
  const reportByGroup = useMemo(() => new Map(reports.map(r => [r.pedagogical_group_id, r])), [reports]);
  const promotionById = useMemo(() => new Map(promotions.map(p => [p.id, p])), [promotions]);
  const latestDeliveryCorrectionByReport = useMemo(() => {
    const latest = new Map<string, DeliveryInitialCorrection>();
    for (const correction of deliveryInitialCorrections) {
      if (!latest.has(correction.school_report_id)) latest.set(correction.school_report_id, correction);
    }
    return latest;
  }, [deliveryInitialCorrections]);
  const rows = useMemo(() => groups.map(group => {
    const report = reportByGroup.get(group.id);
    const data = report?.report_data ?? {};
    const capacity = Number(data.C ?? 0);
    const initial = Number(data.D ?? 0);
    const ops = operations.filter(op => op.pedagogical_group_id === group.id);
    const sum = (type: string) => ops.filter(op => op.operation_type === type).reduce((n, op) => n + Number(op.quantity), 0);
    const ratissage = sum('ENROLLMENT_RATISSAGE');
    const correction = sum('ENROLLMENT_CORRECTION');
    const enrolled = initial + ratissage;
    const originalDeliveredInitial = sum('DELIVERY_INITIAL');
    const deliveredInitial = report
      ? Number(latestDeliveryCorrectionByReport.get(report.id)?.quantity ?? originalDeliveredInitial)
      : originalDeliveredInitial;
    const deliveredRatissage = sum('DELIVERY_RATISSAGE');
    const deliveredCorrection = sum('DELIVERY_CORRECTION_FIRST_ISSUE');
    const reprints = sum('DELIVERY_REPRINT');
    const delivered = deliveredInitial + deliveredRatissage + deliveredCorrection;
    return { group, promotion: promotionById.get(group.promotion_id), capacity, initial, ratissage, correction, enrolled,
      deliveredInitial, deliveredRatissage, deliveredCorrection, reprints, delivered,
      enrollmentRemaining: capacity - enrolled, deliveryRemaining: enrolled - delivered,
      deliveryRate: enrolled ? delivered / enrolled * 100 : 0, hasReport: !!report };
  }).sort((a, b) => (a.promotion?.label ?? a.promotion?.code ?? '').localeCompare((b.promotion?.label ?? b.promotion?.code ?? ''), 'fr', { numeric: true, sensitivity: 'base' })), [groups, reportByGroup, operations, promotionById, latestDeliveryCorrectionByReport]);

  const selectedReport = selectedGroup ? reportByGroup.get(selectedGroup) : undefined;
  const hasInitialReport = !!selectedReport;
  const selectedGroupOperations = operations.filter(op => op.pedagogical_group_id === selectedGroup);
  const originalInitialDelivery = selectedGroupOperations
    .filter(op => op.operation_type === 'DELIVERY_INITIAL')
    .reduce((total, op) => total + Number(op.quantity), 0);
  const selectedInitialDeliveryCorrection = selectedReport
    ? latestDeliveryCorrectionByReport.get(selectedReport.id)
    : undefined;
  const effectiveInitialDelivery = Number(selectedInitialDeliveryCorrection?.quantity ?? originalInitialDelivery);
  const hasInitialDelivery = originalInitialDelivery > 0;

  useEffect(() => {
    if (!selectedGroup) {
      setCapacity('');
      setInitialEnrollment('');
      setEditingInitial(false);
      setEditingInitialDelivery(false);
      return;
    }
    const data = reportByGroup.get(selectedGroup)?.report_data;
    setCapacity(data?.C == null ? '' : String(data.C));
    setInitialEnrollment(data?.D == null ? '' : String(data.D));
    setEditingInitial(!data || (data.C == null && data.D == null));
    setEditingInitialDelivery(false);
    setQuantity('');
  }, [selectedGroup, reportByGroup, latestDeliveryCorrectionByReport, operations]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    capacity: t.capacity + r.capacity, initial: t.initial + r.initial, ratissage: t.ratissage + r.ratissage,
    correction: t.correction + r.correction, enrolled: t.enrolled + r.enrolled, delivered: t.delivered + r.delivered,
    deliveredInitial: t.deliveredInitial + r.deliveredInitial, deliveredRatissage: t.deliveredRatissage + r.deliveredRatissage,
    deliveredCorrection: t.deliveredCorrection + r.deliveredCorrection, enrollmentRemaining: t.enrollmentRemaining + r.enrollmentRemaining,
    deliveryRemaining: t.deliveryRemaining + r.deliveryRemaining,
  }), { capacity: 0, initial: 0, ratissage: 0, correction: 0, enrolled: 0, delivered: 0,
    deliveredInitial: 0, deliveredRatissage: 0, deliveredCorrection: 0, enrollmentRemaining: 0, deliveryRemaining: 0 }),
  [rows]);


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!supabase) {
      setError('La connexion à Supabase est indisponible. Rechargez la page puis réessayez.');
      return;
    }
    if (!selectedGroup) {
      setError('Sélectionnez une classe avant d’enregistrer la livraison.');
      return;
    }
    setBusy(true);
    try {
      if (entryType === 'INITIAL') {
        if (!canEnrollment) throw new Error('Cette saisie est réservée à la Catégorie 1.');
        const cap = Number(capacity), enrolled = Number(initialEnrollment);
        if (!Number.isInteger(cap) || !Number.isInteger(enrolled) || cap <= 0 || enrolled < 0 || enrolled > cap)
          throw new Error('Vérifie l’effectif de la classe et l’effectif enrôlé initial.');
        const { error: saveError } = await supabase.rpc('save_school_report', {
          p_pedagogical_group_id: selectedGroup,
          p_changes: { C: String(cap), D: String(enrolled) },
        });
        if (saveError) throw saveError;
        setNotice(hasInitialReport ? 'Modifications de la saisie initiale enregistrées.' : 'Enrôlement initial enregistré.');
        setEditingInitial(false);
      } else if (entryType === 'DELIVERY_INITIAL' && hasInitialDelivery && editingInitialDelivery) {
        const amount = Number(quantity);
        if (!Number.isInteger(amount) || amount < 0) throw new Error('La quantité corrigée doit être un entier positif ou zéro.');
        const { error: correctionError } = await supabase.rpc('correct_school_report_initial_delivery', {
          p_pedagogical_group_id: selectedGroup,
          p_quantity: amount,
          p_note: note.trim() || 'Correction d’une erreur de saisie de la livraison initiale',
        });
        if (correctionError) throw correctionError;
        setNotice('La livraison initiale a été corrigée. Le tableau partagé a été actualisé.');
        setEditingInitialDelivery(false);
      } else {
        const amount = Number(quantity);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('La quantité doit être un entier positif.');
        const { error: rpcError } = await supabase.rpc('record_school_report_operation', {
          p_pedagogical_group_id: selectedGroup,
          p_operation_type: entryType,
          p_quantity: amount,
          p_idempotency_key: globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
                const random = Math.random() * 16 | 0;
                return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
              }),
          p_note: note.trim() || null,
        });
        if (rpcError) throw rpcError;
        setNotice('Opération enregistrée et tableau de bord actualisé.');
      }
      setQuantity(''); setNote('');
      await load();
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : typeof cause === 'object' && cause !== null && 'message' in cause
          ? String((cause as { message: unknown }).message)
          : 'Échec de l’enregistrement.';
      setError(message);
    } finally { setBusy(false); }
  }

  const fmt = (value: number) => value.toLocaleString('fr-FR');
  const enrollmentRate = totals.capacity ? totals.enrolled / totals.capacity * 100 : 0;
  const deliveryRate = totals.enrolled ? totals.delivered / totals.enrolled * 100 : 0;
  const hasBothEntryCategories = canEnrollment && canDelivery;
  const activeEntryCategory = canEnrollment && canDelivery
    ? selectedEntryCategory
    : canDelivery ? 'CATEGORY_2' : 'CATEGORY_1';
  const category1Types = [
    { value: 'INITIAL', label: 'Enrôlement initial' },
    { value: 'ENROLLMENT_RATISSAGE', label: 'Ratissage' },
    { value: 'ENROLLMENT_CORRECTION', label: 'Correction' },
  ];
  const category2Types = [
    { value: 'DELIVERY_INITIAL', label: 'Livraison initiale' },
    { value: 'DELIVERY_RATISSAGE', label: 'Livraison ratissage' },
    { value: 'DELIVERY_CORRECTION_FIRST_ISSUE', label: 'Livraison correction' },
    { value: 'DELIVERY_REPRINT', label: 'Réimpression' },
  ];
  const allowedTypes = activeEntryCategory === 'CATEGORY_1'
    ? (canEnrollment ? category1Types : [])
    : (canDelivery ? category2Types : []);

  useEffect(() => {
    if (!allowedTypes.some(type => type.value === entryType) && allowedTypes.length > 0) {
      setEntryType(allowedTypes[0].value);
      setQuantity('');
      setNote('');
    }
  }, [allowedTypes.map(type => type.value).join('|'), entryType]);

  return <div className="report-app">
    <aside className="report-sidebar">
      <div className="report-brand"><GraduationCap/><b>Rapports<br/>Scolaires</b></div>
      <nav><a className="active"><Activity/> Tableau de bord</a><a href="#collecte"><ClipboardList/> Collecte des données</a><a href="#classes"><BookOpen/> Suivi par classes</a><a href="#historique"><History/> Historique des opérations</a><a href="#bordereaux"><Truck/> Bordereaux de livraison</a>{canReadCorrectionReasons && <a href="#motifs-modification"><BookOpen/> Motifs de modification</a>}</nav>
      <div className="report-user"><div className="report-avatar"><Users/></div><span>Agent de collecte</span><button onClick={onSignOut} title="Se déconnecter"><LogOut/></button></div>
    </aside>
    <main className="report-main">
      <header className="report-topbar">
        <div><h1>Tableau de bord — Rapports scolaires</h1><p>Suivi de l’enrôlement et de la livraison · {school?.name ?? 'Établissement'}</p></div>
        <div className="report-context">
          {onBackToAdmin && <button type="button" onClick={onBackToAdmin} title="Retourner à l’administration"><ShieldCheck/> Espace Admin</button>}
          <label><span>Département</span><select value={selectedDepartmentId} disabled={availableDepartments.length === 0} onChange={e => { const nextDepartmentId = e.target.value; const candidates = schools.filter(s => !nextDepartmentId || s.department_id === nextDepartmentId); const nextSchoolId = candidates[0]?.id ?? ''; setSelectedDepartmentId(nextDepartmentId); setSelectedCommune(''); setSelectedGroup(''); schoolIdRef.current = nextSchoolId; void load(true, nextSchoolId); }}><option value="">{availableDepartments.length ? 'Tous les départements' : 'Aucun établissement actif'}</option>{availableDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label><span>Commune</span><select value={selectedCommune} onChange={e => { const nextCommune = e.target.value; const candidates = schools.filter(s => (!selectedDepartmentId || s.department_id === selectedDepartmentId) && s.commune_id === nextCommune); const nextSchoolId = candidates[0]?.id ?? ''; setSelectedCommune(nextCommune); setSelectedGroup(''); schoolIdRef.current = nextSchoolId; void load(true, nextSchoolId); }}><option value="">Toutes</option>{availableCommunes.map(commune => <option key={commune.id} value={commune.id}>{commune.name}</option>)}</select></label>
          {filteredSchools.length > 1 && <label><Building2/><select value={schoolId} onChange={e => { const nextSchoolId = e.target.value; const nextSchool = schools.find(s => s.id === nextSchoolId); schoolIdRef.current = nextSchoolId; setSchoolId(nextSchoolId); if (nextSchool) { setSelectedDepartmentId(nextSchool.department_id); setSelectedCommune(nextSchool.commune_id ?? ''); } setSelectedGroup(''); setEntryType('INITIAL'); setCapacity(''); setInitialEnrollment(''); setQuantity(''); setNote(''); setNotice(''); setError(''); void load(true, nextSchoolId); }}>{filteredSchools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <span><BookOpen/> {year?.label ?? 'Aucune année active'}</span>
          <button onClick={() => void load()} disabled={loading}><RefreshCw/></button>
        </div>
      </header>
      {error && <div className="report-alert error">{error}</div>}
      {notice && <div className="report-alert success"><CheckCircle2/> {notice}</div>}
      {loading ? <div className="report-loading"><RefreshCw className="spin"/> Chargement des données de l’établissement…</div> : <>
        {!year && <div className="report-alert error">Aucune année scolaire active n’a été définie par l’administration centrale.</div>}
        {!school && <div className="report-empty">Aucun établissement autorisé n’est associé à ce compte.</div>}
        {school && <>
          <section className="report-school-banner"><div className="report-school-icon"><Building2/></div><div><h2>{school.name}</h2><p>{school.code} · {year?.label}</p></div><div className="report-category cat-one"><Users/><b>Catégorie 1</b><small>Enrôlement · Ratissage · Correction</small></div><div className="report-category cat-two"><Truck/><b>Catégorie 2</b><small>Livraison · Réimpression</small></div><div className="report-category cat-common"><Users/><b>Tableau de bord commun</b><small>Données partagées et actualisées</small></div></section>
          <SchoolPedagogicalClasses schoolId={school.id} schoolName={school.name} yearId={year?.id ?? ''} yearLabel={year?.label ?? ''} promotions={promotions} groups={groups} canConfigure={canEnrollment} onSaved={() => void load()}/>
          <section className="report-metrics">
            <Metric icon={<Users/>} label="Effectif total" value={fmt(totals.capacity)} tone="blue"/>
            <Metric icon={<ClipboardList/>} label="Enrôlement initial" value={fmt(totals.initial)} tone="purple"/>
            <Metric icon={<RefreshCw/>} label="Ratissage cumulé" value={fmt(totals.ratissage)} tone="green"/>
            <Metric icon={<Activity/>} label="Corrections" value={fmt(totals.correction)} tone="purple"/>
            <Metric icon={<Users/>} label="Total réellement enrôlé" value={fmt(totals.enrolled)} tone="green"/>
            <Metric icon={<Truck/>} label="Total livré unique" value={fmt(totals.delivered)} tone="blue"/>
            <Metric icon={<PackageCheck/>} label="Reste à livrer" value={fmt(totals.deliveryRemaining)} tone="orange"/>
          </section>
          <section className="report-progress-grid">
            <article className="report-panel"><h3>Progression globale</h3><Progress label="Taux d’enrôlement" value={enrollmentRate}/><Progress label="Taux de livraison" value={deliveryRate}/></article>
            <article className="report-panel report-distribution"><h3>Répartition des effectifs</h3><div className="report-donut" style={{'--enrolled': `${Math.min(enrollmentRate,100)}%`} as React.CSSProperties}><b>{fmt(totals.capacity)}</b><small>Effectif total</small></div><div className="report-legend"><span>Initial : {fmt(totals.initial)}</span><span>Ratissage : {fmt(totals.ratissage)}</span><span>Corrections : {fmt(totals.correction)}</span><span>Reste à enrôler : {fmt(totals.enrollmentRemaining)}</span></div></article>
            <article className="report-panel"><h3>Livraison par type</h3><div className="report-bars"><Bar label="Initiale" value={totals.deliveredInitial}/><Bar label="Ratissage" value={totals.deliveredRatissage}/><Bar label="Correction" value={totals.deliveredCorrection}/></div></article>
          </section>
          <section className="report-panel report-classes" id="classes"><h3>Détail par classe <small>Suivi complet et partagé</small></h3>
            <div className="report-table-wrap"><table><thead><tr><th>Classe / groupe</th><th>Effectif</th><th>Initial</th><th>Ratissage</th><th>Correction</th><th>Total enrôlé</th><th>Livré initial</th><th>Livré ratissage</th><th>Livré correction</th><th>Total livré</th><th>Reste enrôler</th><th>Reste livrer</th><th>Taux livraison</th></tr></thead><tbody>
              {rows.map(r => <tr key={r.group.id}><td><b>{r.promotion?.label ?? r.promotion?.code ?? '—'}</b></td><td>{fmt(r.capacity)}</td><td>{fmt(r.initial)}</td><td>{fmt(r.ratissage)}</td><td>{fmt(r.correction)}</td><td className="good">{fmt(r.enrolled)}</td><td>{fmt(r.deliveredInitial)}</td><td>{fmt(r.deliveredRatissage)}</td><td>{fmt(r.deliveredCorrection)}</td><td className="good">{fmt(r.delivered)}</td><td>{fmt(r.enrollmentRemaining)}</td><td className={r.deliveryRemaining < 0 ? 'bad' : ''}>{fmt(r.deliveryRemaining)}</td><td>{r.enrolled ? `${r.deliveryRate.toFixed(1)} %` : '—'}</td></tr>)}
              <tr className="report-total"><td>Total</td><td>{fmt(totals.capacity)}</td><td>{fmt(totals.initial)}</td><td>{fmt(totals.ratissage)}</td><td>{fmt(totals.correction)}</td><td>{fmt(totals.enrolled)}</td><td>{fmt(totals.deliveredInitial)}</td><td>{fmt(totals.deliveredRatissage)}</td><td>{fmt(totals.deliveredCorrection)}</td><td>{fmt(totals.delivered)}</td><td>{fmt(totals.enrollmentRemaining)}</td><td>{fmt(totals.deliveryRemaining)}</td><td>{deliveryRate.toFixed(1)} %</td></tr>
            </tbody></table>{rows.length === 0 && <div className="report-empty">Aucune classe n’est encore affectée à cet établissement pour l’année active.</div>}</div>
          </section>
          <section className="report-entry-grid" id="collecte">
            <form className={`report-panel report-entry ${activeEntryCategory === 'CATEGORY_2' ? 'report-entry-delivery' : ''}`} onSubmit={submit}>
              <h3>{activeEntryCategory === 'CATEGORY_2' ? <><Truck/> Saisie des livraisons — Catégorie 2</> : <><Users/> Saisie de l’enrôlement — Catégorie 1</>}</h3>
              {hasBothEntryCategories && <div className="report-entry-category-switch" role="group" aria-label="Catégorie de saisie">
                <button type="button" className={activeEntryCategory === 'CATEGORY_1' ? 'active category-one' : 'category-one'} onClick={() => { setSelectedEntryCategory('CATEGORY_1'); setEntryType('INITIAL'); setEditingInitialDelivery(false); setQuantity(''); setNote(''); setError(''); setNotice(''); }}> <Users size={16}/> Catégorie 1</button>
                <button type="button" className={activeEntryCategory === 'CATEGORY_2' ? 'active category-two' : 'category-two'} onClick={() => { setSelectedEntryCategory('CATEGORY_2'); setEntryType('DELIVERY_INITIAL'); setEditingInitialDelivery(false); setQuantity(''); setNote(''); setError(''); setNotice(''); }}> <Truck size={16}/> Catégorie 2</button>
              </div>}
              {activeEntryCategory === 'CATEGORY_2' && <p className="report-entry-intro">Enregistrez les quantités livrées pour une classe déjà affectée à cet établissement. Les données mettent à jour les mêmes lignes du tableau partagé.</p>}
              <label>{activeEntryCategory === 'CATEGORY_2' ? "Type de livraison" : "Type d’opération"}<select value={entryType} onChange={e => { setEntryType(e.target.value); setEditingInitialDelivery(false); setQuantity(''); setNote(''); }}>{allowedTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
              <label>Classe<select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} required><option value="">Sélectionner une classe</option>{rows.map(r => <option key={r.group.id} value={r.group.id}>{r.promotion?.label ?? r.promotion?.code ?? 'Classe'}</option>)}</select></label>
              {entryType === 'DELIVERY_INITIAL' && hasInitialDelivery && !editingInitialDelivery && <div className="report-initial-status"><span>Livraison initiale déjà enregistrée : <b>{fmt(effectiveInitialDelivery)}</b>.</span><button type="button" className="report-edit-button" onClick={() => { setQuantity(String(effectiveInitialDelivery)); setEditingInitialDelivery(true); setNote(''); }}>Modifier</button></div>}
              {entryType === 'INITIAL' ? <>
                {hasInitialReport && !editingInitial && <div className="report-initial-status"><span>Données initiales déjà enregistrées pour cette classe.</span><button type="button" className="report-edit-button" onClick={() => setEditingInitial(true)}>Modifier</button></div>}
                <div className="report-entry-fields"><label>Effectif de la classe<input type="number" min="1" step="1" value={capacity} onChange={e => setCapacity(e.target.value)} required readOnly={!editingInitial}/></label><label>Effectif enrôlé initial<input type="number" min="0" step="1" value={initialEnrollment} onChange={e => setInitialEnrollment(e.target.value)} required readOnly={!editingInitial}/></label></div>
                {editingInitial && <button className="report-submit" type="submit" disabled={busy || !selectedGroup}>{busy ? 'Enregistrement…' : hasInitialReport ? 'Enregistrer les modifications' : 'Enregistrer l’enrôlement initial'}</button>}
              </> : entryType === 'DELIVERY_INITIAL' && hasInitialDelivery ? <label>Quantité de livraison initiale corrigée<input type="number" min="0" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required readOnly={!editingInitialDelivery}/></label> : <label>{entryType === 'DELIVERY_REPRINT' ? "Nombre de réimpressions" : activeEntryCategory === 'CATEGORY_2' ? "Quantité livrée" : "Quantité à enrôler"}<input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required/></label>}
              {entryType !== 'INITIAL' && <label>Observations (facultatif)<textarea value={note} onChange={e => setNote(e.target.value)} rows={2}/></label>}
              {entryType !== 'INITIAL' && !(entryType === 'DELIVERY_INITIAL' && hasInitialDelivery && !editingInitialDelivery) && <button type="submit" className="report-submit" disabled={busy || !selectedGroup}>{busy ? 'Enregistrement…' : entryType === 'DELIVERY_INITIAL' && hasInitialDelivery ? 'Enregistrer les modifications' : 'Enregistrer l’opération'}</button>}
            </form>
            <article className="report-panel report-history" id="historique"><h3><History/> Dernières opérations</h3>{operations.slice(0,8).map(op => <div className="report-history-row" key={op.id}><span>{operationLabels[op.operation_type] ?? op.operation_type}</span><b>{fmt(op.quantity)}</b><small>{new Date(op.created_at).toLocaleString('fr-FR')}</small></div>)}{operations.length === 0 && <div className="report-empty">Aucune opération enregistrée.</div>}</article>
          </section>
          <section id="bordereaux"><DeliverySlips memberships={memberships}/>{(memberships.some(item => item.role === 'CENTRAL_ADMIN') || memberships.some(item => item.role === 'CATEGORY_2')) && <AutomaticDeliverySlips memberships={memberships}/>}</section>
          {canReadCorrectionReasons && <section id="motifs-modification">
            <Suspense fallback={<div className="report-loading">Chargement des motifs de modification…</div>}>
              <SchoolCorrectionReasons schoolId={school.id} schoolName={school.name} permissions={{ canRead: true, canCreate: canManageCorrectionReasons, canUpdate: canManageCorrectionReasons, canDelete: canManageCorrectionReasons }}/>
            </Suspense>
          </section>}
        </>}
      </>}
    </main>
  </div>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return <article className={`report-metric ${tone}`}><div>{icon}<span>{label}</span></div><b>{value}</b></article>;
}
function Progress({ label, value }: { label: string; value: number }) {
  return <div className="report-progress"><div><b>{label}</b><span>{value.toFixed(1)} %</span></div><div className="report-track"><i style={{width:`${Math.max(0,Math.min(value,100))}%`}}/></div></div>;
}
function Bar({ label, value }: { label: string; value: number }) {
  return <div className="report-bar"><span>{label}</span><div><i style={{height:`${Math.max(3,Math.min(value,100))}%`}}/></div><b>{value}</b></div>;
}
