import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Printer,
  RefreshCw, Sparkles, Truck,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import './AutomaticDeliverySlips.css';

type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };
type School = { id: string; department_id: string; code: string; name: string };
type Year = { id: string; label: string; code: string };
type Candidate = {
  pedagogical_group_id: string; promotion_id: string; promotion_label: string;
  group_code: string; current_delivered: number; already_slipped: number;
  available_to_slip: number; has_report: boolean;
};
type Slip = {
  id: string; school_id: string; school_year_id: string; slip_number: string;
  delivery_date: string; status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'CANCELLED';
  observations: string | null; responsible_agent: string | null;
  creator_full_name: string | null; organization_snapshot: Record<string, unknown> | null;
};
type SlipLine = { id: string; promotion_id: string; group_code: string; quantity_delivered: number };

const statusLabels: Record<Slip['status'], string> = {
  DRAFT: 'Brouillon', SUBMITTED: 'Soumis', VALIDATED: 'Validé', CANCELLED: 'Annulé',
};
const classLabel = (label: string, code: string) =>
  code.trim().toUpperCase() === 'UNIQUE'
    ? label
    : (label.match(/^(.*?)[\s-]+(M\d+)$/i)
      ? label.replace(/^(.*?)[\s-]+(M\d+)$/i, '$1') + ' ' + code
      : label + ' ' + code);

export default function AutomaticDeliverySlips({
  memberships, selectedSchoolId, onSchoolChange,
}: {
  memberships: Membership[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
}) {
  const isAdmin = memberships.some(item => item.role === 'CENTRAL_ADMIN');
  const [schools, setSchools] = useState<School[]>([]);
  const [year, setYear] = useState<Year | null>(null);
  const schoolId = selectedSchoolId;
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<Slip[]>([]);
  const [selectedSlip, setSelectedSlip] = useState<Slip | null>(null);
  const [slipLines, setSlipLines] = useState<SlipLine[]>([]);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [agent, setAgent] = useState('');
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const requestRef = useRef(0);
  const slipRequestRef = useRef(0);

  const school = schools.find(item => item.id === schoolId);
  const canGenerate = !!school && (isAdmin || memberships.some(
    item => item.department_id === school.department_id && item.role === 'CATEGORY_2',
  ));
  const fmt = (value: number) => Number(value).toLocaleString('fr-FR');
  const toggleBlock = (key: string) =>
    setCollapsed(current => ({ ...current, [key]: !current[key] }));
  const blockToggle = (key: string, label: string) => (
    <button
      type="button"
      className="automatic-delivery-collapse"
      aria-expanded={!collapsed[key]}
      onClick={() => toggleBlock(key)}
    >
      {collapsed[key] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      {collapsed[key] ? 'Afficher' : 'Masquer'} {label}
    </button>
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!supabase || !schoolId || !year) {
      setCandidates([]);
      setSelectedIds([]);
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc(
      'get_automatic_delivery_slip_candidates',
      { p_school_id: schoolId, p_school_year_id: year.id },
    );
    if (requestId !== requestRef.current) return;
    if (rpcError) {
      setError(rpcError.message);
      setCandidates([]);
      setSelectedIds([]);
    } else {
      const rows = (data ?? []) as Candidate[];
      setCandidates(rows);
      setSelectedIds(rows.filter(item => item.available_to_slip > 0).map(item => item.pedagogical_group_id));
    }
    const { data: slips, error: slipError } = await supabase
      .from('delivery_slips')
      .select('id,school_id,school_year_id,slip_number,delivery_date,status,observations,responsible_agent,creator_full_name,organization_snapshot')
      .eq('school_id', schoolId)
      .eq('school_year_id', year.id)
      .eq('creation_mode', 'AUTOMATIC')
      .order('created_at', { ascending: false });
    if (requestId !== requestRef.current) return;
    if (slipError) setError(slipError.message);
    else setHistory((slips ?? []) as Slip[]);
    setLoading(false);
  }, [schoolId, year]);

  useEffect(() => {
    if (!supabase) return;
    void Promise.all([
      supabase.from('schools').select('id,department_id,code,name').eq('is_active', true).order('name'),
      supabase.from('school_years').select('id,label,code').eq('is_active', true).limit(1).maybeSingle(),
    ]).then(([schoolResult, yearResult]) => {
      if (schoolResult.error || yearResult.error) {
        setError(schoolResult.error?.message ?? yearResult.error?.message ?? 'Erreur de chargement');
        setLoading(false);
        return;
      }
      setSchools((schoolResult.data ?? []) as School[]);
      setYear((yearResult.data ?? null) as Year | null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    slipRequestRef.current += 1;
    setSelectedSlip(null);
    setSlipLines([]);
    setError('');
    setNotice('');
  }, [schoolId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const chosen = useMemo(
    () => candidates.filter(item => selectedIds.includes(item.pedagogical_group_id) && item.available_to_slip > 0),
    [candidates, selectedIds],
  );
  const total = chosen.reduce((sum, item) => sum + item.available_to_slip, 0);
  const anomalies = candidates.filter(item => item.available_to_slip < 0);
  const toggle = (id: string, checked: boolean) =>
    setSelectedIds(current => checked ? [...current, id] : current.filter(item => item !== id));

  async function openSlip(slip: Slip) {
    if (!supabase) return;
    const requestId = ++slipRequestRef.current;
    setSelectedSlip(slip);
    const { data, error: queryError } = await supabase
      .from('delivery_slip_lines')
      .select('id,promotion_id,group_code,quantity_delivered')
      .eq('delivery_slip_id', slip.id)
      .order('created_at');
    if (requestId !== slipRequestRef.current) return;
    if (queryError) {
      setError(queryError.message);
      setSlipLines([]);
    } else {
      setSlipLines((data ?? []) as SlipLine[]);
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId || !year || !canGenerate || !selectedIds.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: createError } = await supabase.rpc('create_automatic_delivery_slip', {
      p_school_id: schoolId,
      p_school_year_id: year.id,
      p_slip_number: number.trim(),
      p_delivery_date: date,
      p_group_ids: selectedIds,
      p_observations: observations.trim() || null,
      p_responsible_agent: agent.trim() || null,
    });
    setBusy(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setNumber('');
    setAgent('');
    setObservations('');
    setNotice('Bordereau automatique créé. Les quantités ont été réservées dans son historique.');
    await refresh();
    if (data) await openSlip(data as Slip);
  }

  const print = () => {
    document.body.classList.add('automatic-delivery-print-mode');
    const done = () => document.body.classList.remove('automatic-delivery-print-mode');
    window.addEventListener('afterprint', done, { once: true });
    window.print();
  };

  return (
    <div className="automatic-delivery-module">
      <div className="automatic-delivery-heading">
        <div>
          <span className="automatic-delivery-eyebrow">NOUVEAU MODE · SANS RESSAISIE</span>
          <h2><Sparkles size={20} /> Bordereau automatique</h2>
          <p>Effectif livré actuel moins le cumul déjà bordereauté. Les classes exclues restent disponibles.</p>
        </div>
        <button type="button" className="automatic-delivery-secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>

      {error && <div className="automatic-delivery-alert error"><AlertTriangle size={16} />{error}</div>}
      {notice && <div className="automatic-delivery-alert success"><CheckCircle2 size={16} />{notice}</div>}

      <div className="automatic-delivery-grid">
        <section className="automatic-delivery-panel">
          <div className="automatic-delivery-panel-heading">
            <h3><Truck size={17} /> Préparer le prochain bordereau</h3>
            {blockToggle('prepare', 'la préparation')}
          </div>
          {!collapsed.prepare && (
            <form className="automatic-delivery-form" onSubmit={generate}>
              <div className="automatic-delivery-block wide">
                <div className="automatic-delivery-block-heading">
                  <b>Informations du bordereau</b>
                  {blockToggle('details', 'les informations')}
                </div>
                {!collapsed.details && (
                  <div className="automatic-delivery-fields">
                    <label className="wide">Établissement
                      <select
                        value={schoolId}
                        onChange={event => {
                          const nextId = event.target.value;
                          setSelectedSlip(null);
                          setSlipLines([]);
                          onSchoolChange(nextId);
                        }}
                        required
                      >
                        <option value="">Choisir un établissement</option>
                        {schools.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}
                      </select>
                    </label>
                    <label>Année scolaire<input readOnly value={year?.label ?? 'Aucune année active'} /></label>
                    <label>Numéro du bordereau<input required maxLength={60} value={number} onChange={event => setNumber(event.target.value)} placeholder="Ex. BOR-AUTO-2026-002" /></label>
                    <label>Date de livraison<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
                    <label>Agent responsable<input value={agent} onChange={event => setAgent(event.target.value)} maxLength={160} /></label>
                    <label className="wide">Observations<textarea rows={2} value={observations} onChange={event => setObservations(event.target.value)} /></label>
                  </div>
                )}
              </div>

              <div className="automatic-delivery-block wide">
                <div className="automatic-delivery-block-heading">
                  <div><b>Classes à inclure</b><small>Décochez une classe pour la garder pour un prochain bordereau.</small></div>
                  {blockToggle('candidates', 'les classes')}
                </div>
                {!collapsed.candidates && (
                  <>
                    <div className="automatic-delivery-selection">
                      <span className="automatic-delivery-selection-actions">
                        <button type="button" onClick={() => setSelectedIds(candidates.filter(item => item.available_to_slip > 0).map(item => item.pedagogical_group_id))}>Tout sélectionner</button>
                        <button type="button" onClick={() => setSelectedIds([])}>Tout exclure</button>
                      </span>
                    </div>
                    <div className="automatic-delivery-candidates">
                      {candidates.map(item => {
                        const bad = item.available_to_slip < 0;
                        return (
                          <label className={'automatic-delivery-candidate' + (bad ? ' anomaly' : '')} key={item.pedagogical_group_id}>
                            <input type="checkbox" checked={selectedIds.includes(item.pedagogical_group_id)} disabled={bad || item.available_to_slip === 0} onChange={event => toggle(item.pedagogical_group_id, event.target.checked)} />
                            <span><b>{classLabel(item.promotion_label, item.group_code)}</b><small>Livré actuel : {fmt(item.current_delivered)} · Déjà bordereauté : {fmt(item.already_slipped)}</small></span>
                            <strong>{fmt(item.available_to_slip)}</strong>
                            {bad && <em>Anomalie : vérifier l’historique</em>}
                            {!bad && item.available_to_slip === 0 && <em>À jour</em>}
                          </label>
                        );
                      })}
                      {!candidates.length && <p className="automatic-delivery-empty">Aucune classe avec rapport enregistré.</p>}
                    </div>
                    {anomalies.length > 0 && <div className="automatic-delivery-warning"><AlertTriangle size={16} />{anomalies.length} classe(s) bloquée(s) : le cumul bordereauté dépasse l’effectif livré actuel.</div>}
                  </>
                )}
              </div>

              <div className="automatic-delivery-total wide"><span>Total sélectionné</span><b>{fmt(total)}</b></div>
              <button className="automatic-delivery-primary wide" disabled={busy || loading || !canGenerate || !year || !selectedIds.length || total <= 0}>
                {busy ? 'Génération…' : 'Générer le bordereau automatique'}
              </button>
              {!canGenerate && school && <p className="automatic-delivery-hint wide">Réservé à la Catégorie 2 ou à l’administration centrale.</p>}
            </form>
          )}
        </section>

        <section className="automatic-delivery-panel">
          <div className="automatic-delivery-panel-heading">
            <h3>Historique automatique <span>{history.length}</span></h3>
            {blockToggle('history', "l'historique")}
          </div>
          {!collapsed.history && (
            <>
              <div className="automatic-delivery-history">
                {history.map(item => (
                  <button type="button" key={item.id} className={selectedSlip?.id === item.id ? 'selected' : ''} onClick={() => void openSlip(item)}>
                    <span><b>{item.slip_number}</b><small>{new Date(item.delivery_date).toLocaleDateString('fr-FR')}</small></span>
                    <em>{statusLabels[item.status]}</em>
                  </button>
                ))}
                {!history.length && <p className="automatic-delivery-empty">Aucun bordereau automatique enregistré.</p>}
              </div>
              {selectedSlip && (
                <div className="automatic-delivery-selected">
                  <b>{selectedSlip.slip_number} · {selectedSlip.creator_full_name ?? 'Créateur non renseigné'}</b>
                  <button type="button" className="automatic-delivery-secondary" onClick={print} disabled={!slipLines.length}>
                    <Printer size={15} /> Imprimer / PDF
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {selectedSlip && (
        <section className="delivery-document automatic-delivery-print-document">
          <div className="delivery-brandbar">
            <div className="delivery-brand"><div className="delivery-logo"><span>O</span></div><div>
              <h1>{String(selectedSlip.organization_snapshot?.legal_name ?? selectedSlip.organization_snapshot?.short_name ?? 'OMICROME')}</h1>
              <p>{String(selectedSlip.organization_snapshot?.address ?? selectedSlip.organization_snapshot?.country ?? 'COTONOU - BÉNIN')}</p>
            </div></div>
            <div className="delivery-platform-brand"><b>Rapports Scolaires 2026 – 2027</b><span>Gestion et suivi des cartes scolaires</span></div>
          </div>
          <div className="delivery-title-ribbon"><span>BORDEREAU DE LIVRAISON AUTOMATIQUE</span></div>
          <div className="delivery-document-meta">
            <div><span>Établissement :</span><b>{school?.name ?? '—'}</b><span>Agent responsable :</span><b>{selectedSlip.responsible_agent ?? '—'}</b><span>Année scolaire :</span><b>{year?.label ?? '—'}</b></div>
            <div><span>N° Bordereau :</span><b className="delivery-number-pill">{selectedSlip.slip_number}</b><span>Date :</span><b>{new Date(selectedSlip.delivery_date).toLocaleDateString('fr-FR')}</b><span>Statut :</span><b>{statusLabels[selectedSlip.status]}</b></div>
          </div>
          <table className="delivery-print-table">
            <thead><tr><th>N°</th><th>Groupes pédagogiques</th><th>Nouvelle quantité livrée</th></tr></thead>
            <tbody>{slipLines.map((line, index) => (
              <tr key={line.id}><td>{index + 1}</td><td>{classLabel(candidates.find(item => item.promotion_id === line.promotion_id)?.promotion_label ?? 'Classe', line.group_code)}</td><td>{fmt(line.quantity_delivered)}</td></tr>
            ))}</tbody>
            <tfoot><tr><th colSpan={2}>TOTAL GÉNÉRAL</th><th>{fmt(slipLines.reduce((sum, line) => sum + line.quantity_delivered, 0))}</th></tr></tfoot>
          </table>
          {selectedSlip.observations && <p className="delivery-observations"><b>Observations :</b> {selectedSlip.observations}</p>}
          <div className="delivery-signatures">
            <section><h3>Établi par</h3><b className="delivery-person-name">{selectedSlip.creator_full_name ?? '—'}</b><span>Signature</span><div className="delivery-sign-line" /></section>
            <section><h3>Visa de réception</h3><b>Nom et prénoms du réceptionnaire</b><div className="delivery-blank-line" /><b>Fonction</b><div className="delivery-blank-line" /><b>Date de réception</b><div className="delivery-blank-line" /><span>Signature</span><div className="delivery-sign-line" /></section>
            <section><h3>Cachet de l’établissement</h3><div className="delivery-stamp-box" /></section>
          </div>
        </section>
      )}
    </div>
  );
}
