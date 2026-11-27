import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, FilePlus2, Printer, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { supabase } from './lib/supabase';
import './DeliverySlips.css';

type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };
type School = { id: string; department_id: string; code: string; name: string };
type Year = { id: string; label: string; code: string };
type Promotion = { id: string; label: string; code: string };
type PedagogicalGroup = { id: string; school_id: string; school_year_id: string; promotion_id: string; group_code: string };
type Slip = {
  id: string; school_id: string; school_year_id: string; slip_number: string; delivery_date: string;
  status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'CANCELLED'; observations: string | null;
  responsible_agent: string | null; created_by: string; creator_role: string | null; creator_full_name: string | null;
  validated_by: string | null; validated_at: string | null; organization_snapshot: Record<string, unknown> | null;
};
type Line = { id: string; delivery_slip_id: string; promotion_id: string; group_code: string; quantity_delivered: number };

const statusLabels: Record<Slip['status'], string> = {
  DRAFT: 'Brouillon', SUBMITTED: 'Soumis', VALIDATED: 'Validé', CANCELLED: 'Annulé',
};

function numberToFrench(value: number): string {
  const units = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize'];
  const underHundred = (n: number): string => {
    if (n <= 16) return units[n];
    if (n < 20) return 'dix-' + units[n - 10];
    if (n < 70) {
      const tens = Math.floor(n / 10), rest = n % 10;
      const names = ['','','vingt','trente','quarante','cinquante','soixante'];
      if (!rest) return names[tens];
      if (rest === 1) return names[tens] + ' et un';
      return names[tens] + '-' + units[rest];
    }
    if (n < 80) return n === 71 ? 'soixante et onze' : 'soixante-' + underHundred(n - 60);
    if (n < 100) return n === 80 ? 'quatre-vingts' : 'quatre-vingt-' + underHundred(n - 80);
    return '';
  };
  const underThousand = (n: number): string => {
    if (n < 100) return underHundred(n);
    const h = Math.floor(n / 100), rest = n % 100;
    const prefix = h === 1 ? 'cent' : units[h] + ' cent';
    return prefix + (rest ? ' ' + underHundred(rest) : h > 1 ? 's' : '');
  };
  if (!Number.isFinite(value) || value < 0 || value > 999999) return String(value);
  if (value < 1000) return underThousand(value);
  const thousands = Math.floor(value / 1000), rest = value % 1000;
  const prefix = thousands === 1 ? 'mille' : underThousand(thousands) + ' mille';
  return (prefix + (rest ? ' ' + underThousand(rest) : '')).toUpperCase();
}

function quantityInWords(value: number) {
  return numberToFrench(value).toLocaleUpperCase('fr-FR');
}

function publicLogo(path: unknown) {
  if (typeof path !== 'string' || !path || !supabase) return '';
  return supabase.storage.from('organization-logos').getPublicUrl(path).data.publicUrl;
}

export default function DeliverySlips({ memberships, selectedSchoolId, onSchoolChange }: {\n  memberships: Membership[];\n  selectedSchoolId: string;\n  onSchoolChange: (schoolId: string) => void;\n}) {
  const isAdmin = memberships.some(item => item.role === 'CENTRAL_ADMIN');
  const [schools, setSchools] = useState<School[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [year, setYear] = useState<Year | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [groups, setGroups] = useState<PedagogicalGroup[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [selectedSlipId, setSelectedSlipId] = useState('');
  const [creatorRole, setCreatorRole] = useState<'CATEGORY_1' | 'CATEGORY_2' | 'CENTRAL_ADMIN'>(isAdmin ? 'CENTRAL_ADMIN' : 'CATEGORY_1');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [agent, setAgent] = useState('');
  const [observations, setObservations] = useState('');
  const [groupId, setGroupId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isContentVisible, setIsContentVisible] = useState(true);

  useEffect(() => {
    void supabase?.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? ''));
  }, []);

  const selectedSchool = schools.find(item => item.id === schoolId);
  const availableRoles = useMemo(() => {
    if (isAdmin) return ['CENTRAL_ADMIN'] as const;
    return [...new Set(memberships.filter(item => item.department_id === selectedSchool?.department_id)
      .map(item => item.role).filter(role => role === 'CATEGORY_1' || role === 'CATEGORY_2'))] as Array<'CATEGORY_1' | 'CATEGORY_2'>;
  }, [isAdmin, memberships, selectedSchool?.department_id]);

  const load = useCallback(async () => {
    if (!supabase) { setError('La connexion Supabase est indisponible.'); setLoading(false); return; }
    setLoading(true); setError('');
    const [schoolResult, yearResult, promotionResult] = await Promise.all([
      supabase.from('schools').select('id,department_id,code,name').eq('is_active', true).order('name'),
      supabase.from('school_years').select('id,label,code').eq('is_active', true).limit(1).maybeSingle(),
      supabase.from('promotions').select('id,label,code').eq('is_active', true).order('display_order').order('label'),
    ]);
    const firstError = schoolResult.error ?? yearResult.error ?? promotionResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const nextSchools = (schoolResult.data ?? []) as School[];
    const nextYear = yearResult.data as Year | null;
    setSchools(nextSchools); setYear(nextYear); setPromotions((promotionResult.data ?? []) as Promotion[]);
    const nextSchoolId = nextSchools.some(item => item.id === schoolId) ? schoolId : nextSchools[0]?.id ?? '';
    setSchoolId(nextSchoolId);
    if (!nextSchoolId || !nextYear) {
      setGroups([]); setSlips([]); setLines([]); setLoading(false); return;
    }
    // Historique de l'établissement : toutes les années et tous les statuts, brouillons inclus.
    const slipResult = await supabase.from('delivery_slips')
      .select('id,school_id,school_year_id,slip_number,delivery_date,status,observations,responsible_agent,created_by,creator_role,creator_full_name,validated_by,validated_at,organization_snapshot')
      .eq('school_id', nextSchoolId).order('created_at', { ascending: false });
    if (requestId !== loadRequestRef.current) return;\n    if (slipResult.error) { setError(slipResult.error.message); setLoading(false); return; }
    const nextSlips = (slipResult.data ?? []) as Slip[];
    setSlips(nextSlips);
    const nextSelected = nextSlips.some(item => item.id === selectedSlipId) ? selectedSlipId : nextSlips[0]?.id ?? '';
    setSelectedSlipId(nextSelected);
    const selectedYearId = nextSlips.find(item => item.id === nextSelected)?.school_year_id ?? nextYear.id;
    const [groupResult, lineResult] = await Promise.all([
      supabase.from('pedagogical_groups').select('id,school_id,school_year_id,promotion_id,group_code')
        .eq('school_id', nextSchoolId).eq('school_year_id', selectedYearId).order('created_at'),
      nextSelected ? supabase.from('delivery_slip_lines').select('id,delivery_slip_id,promotion_id,group_code,quantity_delivered')
        .eq('delivery_slip_id', nextSelected).order('created_at') : Promise.resolve({ data: [], error: null }),
    ]);
    if (requestId !== loadRequestRef.current) return;\n    if (groupResult.error || lineResult.error) {
      setError(groupResult.error?.message ?? lineResult.error?.message ?? 'Impossible de charger les lignes du bordereau.');
      setLoading(false); return;
    }
    setGroups((groupResult.data ?? []) as PedagogicalGroup[]);
    setLines((lineResult.data ?? []) as Line[]);
    setLoading(false);
  }, [schoolId, selectedSlipId, onSchoolChange]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!availableRoles.includes(creatorRole as never)) {
      setCreatorRole(availableRoles[0] ?? (isAdmin ? 'CENTRAL_ADMIN' : 'CATEGORY_1'));
    }
  }, [availableRoles.join('|'), creatorRole, isAdmin]);

  const selectedSlip = slips.find(item => item.id === selectedSlipId);
  const selectedLines = lines.filter(item => item.delivery_slip_id === selectedSlipId);
  const canManageSelected = Boolean(selectedSlip && (selectedSlip.created_by === currentUserId || isAdmin));
  const canValidate = isAdmin && selectedSlip?.creator_role === 'CATEGORY_2' && selectedSlip.status === 'SUBMITTED';
  const promotionLabel = (id: string) => promotions.find(item => item.id === id)?.label ?? promotions.find(item => item.id === id)?.code ?? '—';
  const groupPresentation = (line: Line) => {
    const promotion = promotions.find(item => item.id === line.promotion_id);
    const rawLabel = promotion?.label ?? promotion?.code ?? '—';
    // Certains anciens catalogues ont enregistré "6e M1" dans le libellé
    // de promotion et "UNIQUE" comme valeur technique de groupe.
    const embedded = rawLabel.match(/^(.*?)[\s-]+(M\d+)$/i);
    const isPlaceholder = line.group_code.trim().toUpperCase() === 'UNIQUE';
    const groupName = isPlaceholder
      ? rawLabel
      : embedded
        ? rawLabel.replace(/^(.*?)[\s-]+(M\d+)$/i, '$1') + ' ' + line.group_code
        : rawLabel + ' ' + line.group_code;
    return {
      promotionName: embedded ? embedded[1].trim() : rawLabel,
      groupName: groupName.trim(),
    };
  };
  const groupedLines = useMemo(() => {
    const map = new Map<string, { label: string; lines: Array<{ line: Line; groupName: string }>; total: number }>();
    selectedLines.forEach(line => {
      const presentation = groupPresentation(line);
      const key = presentation.promotionName.toLocaleLowerCase('fr-FR');
      const group = map.get(key) ?? { label: presentation.promotionName, lines: [], total: 0 };
      group.lines.push({ line, groupName: presentation.groupName });
      group.total += line.quantity_delivered;
      map.set(key, group);
    });
    return [...map.entries()].map(([id, value]) => ({ id, ...value }));
  }, [selectedLines, promotions]);
  const total = selectedLines.reduce((sum, line) => sum + line.quantity_delivered, 0);
  const issuer: Record<string, unknown> = selectedSlip?.organization_snapshot ?? {};
  const logoUrl = publicLogo(issuer.logo_path);
  const issuerName = String(issuer.legal_name ?? issuer.short_name ?? 'OMICROME');
  const creatorName = selectedSlip?.creator_full_name ?? '—';

  async function createSlip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !year || !schoolId) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error: rpcError } = await supabase.rpc('create_delivery_slip_v2', {
      p_school_id: schoolId, p_school_year_id: year.id, p_slip_number: number.trim(),
      p_delivery_date: date, p_creator_role: creatorRole,
      p_observations: observations.trim() || null, p_responsible_agent: agent.trim() || null,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNumber(''); setAgent(''); setObservations('');
    setNotice('Bordereau créé. Ajoutez maintenant les lignes de livraison.');
    await load();
    if (data?.id) setSelectedSlipId(data.id);
  }

  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedSlipId || !groupId) return;
    const group = groups.find(item => item.id === groupId);
    if (!group) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('add_delivery_slip_line', {
      p_delivery_slip_id: selectedSlipId, p_promotion_id: group.promotion_id,
      p_group_code: group.group_code, p_quantity: Number(quantity),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setQuantity(''); setNotice('Ligne ajoutée au bordereau.'); await load();
  }

  async function transition(action: 'submit_delivery_slip' | 'validate_delivery_slip') {
    if (!supabase || !selectedSlipId) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc(action, { p_delivery_slip_id: selectedSlipId });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(action === 'validate_delivery_slip' ? 'Bordereau validé.' : 'Bordereau soumis.'); await load();
  }

  const printSlip = () => window.print();

  return <div className="delivery-module">
    <div className="delivery-heading">
      <div>
        <h2><FilePlus2 size={20}/> Bordereaux de livraison</h2>
        <p>Création, suivi, soumission et impression des bordereaux officiels.</p>
      </div>
      <button
        type="button"
        className="delivery-secondary"
        aria-expanded={isContentVisible}
        onClick={() => setIsContentVisible(visible => !visible)}
      >
        {isContentVisible ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
        {isContentVisible ? 'Masquer' : 'Afficher'}
      </button>
    </div>
    {isContentVisible && <div className="delivery-content">
    <div className="delivery-legacy-refresh">
      <button type="button" className="delivery-secondary" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={15}/> Actualiser
      </button>
    </div>
    {error && <div className="delivery-alert error">{error}</div>}
    {notice && <div className="delivery-alert success"><CheckCircle2 size={16}/>{notice}</div>}
    <div className="delivery-layout">
      <section className="delivery-panel">
        <h3><FilePlus2 size={17}/> Nouveau bordereau</h3>
        <form className="delivery-form" onSubmit={createSlip}>
          <label>Établissement<select required value={schoolId} onChange={event => onSchoolChange(event.target.value)}><option value="">Choisir un établissement</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
          <label>Année scolaire<input value={year?.label ?? 'Aucune année active'} readOnly/></label>
          <label>Rôle émetteur<select value={creatorRole} onChange={event => setCreatorRole(event.target.value as typeof creatorRole)} disabled={availableRoles.length <= 1}><option value="CENTRAL_ADMIN">Administration centrale</option><option value="CATEGORY_1">Catégorie 1</option><option value="CATEGORY_2">Catégorie 2</option></select></label>
          <label>Numéro du bordereau<input value={number} onChange={event => setNumber(event.target.value)} required maxLength={60} placeholder="Ex. BOR-2026-001"/></label>
          <label>Date de livraison<input type="date" value={date} onChange={event => setDate(event.target.value)} required/></label>
          <label>Agent responsable<input value={agent} onChange={event => setAgent(event.target.value)} maxLength={160} placeholder="Nom de l’agent"/></label>
          <label className="wide">Observations<textarea value={observations} onChange={event => setObservations(event.target.value)} rows={2}/></label>
          <button className="delivery-primary wide" type="submit" disabled={busy || !year || !schoolId || availableRoles.length === 0}>{busy ? 'Création…' : 'Créer le bordereau'}</button>
        </form>
      </section>
      <section className="delivery-panel">
        <label className="delivery-school-filter">Établissement
          <select value={schoolId} onChange={event => { setSchoolId(event.target.value); setSelectedSlipId(''); }}>
            <option value="">Choisir un établissement</option>
            {schools.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}
          </select>
        </label>
        <h3>Historique des bordereaux <span>{slips.length}</span></h3>
        <div className="delivery-slip-list">{slips.map(item => <button type="button" key={item.id} className={item.id === selectedSlipId ? 'selected' : ''} onClick={() => setSelectedSlipId(item.id)}><span><b>{item.slip_number}</b><small>{new Date(item.delivery_date).toLocaleDateString('fr-FR')} · {item.creator_full_name ?? 'Ancien bordereau'}</small></span><em className={'status '+item.status.toLowerCase()}>{statusLabels[item.status]}</em></button>)}{slips.length === 0 && <p className="delivery-empty">Aucun bordereau enregistré pour cet établissement.</p>}</div>
      </section>
    </div>
    {selectedSlip && <section className="delivery-panel delivery-actions">
      {selectedSlip.status === 'DRAFT' && <form className="delivery-add-line" onSubmit={addLine}><select value={groupId} onChange={event=>setGroupId(event.target.value)} required><option value="">Choisir un groupe pédagogique</option>{groups.map(group=><option key={group.id} value={group.id}>{promotionLabel(group.promotion_id)} · {group.group_code}</option>)}</select><input type="number" min="0" step="1" value={quantity} onChange={event=>setQuantity(event.target.value)} required placeholder="Quantité"/><button className="delivery-primary" disabled={busy || !canManageSelected}>Ajouter la ligne</button></form>}
      {selectedSlip.status === 'DRAFT' && <button className="delivery-primary" onClick={()=>void transition('submit_delivery_slip')} disabled={busy || selectedLines.length===0}><Send size={15}/> Soumettre</button>}
      {canValidate && <button className="delivery-primary validate" onClick={()=>void transition('validate_delivery_slip')} disabled={busy}><ShieldCheck size={15}/> Valider (administration)</button>}
      <button className="delivery-secondary" onClick={printSlip}><Printer size={15}/> Imprimer / PDF</button>
    </section>}
    {selectedSlip && <section className="delivery-panel delivery-document delivery-print-only" id="delivery-print">
      <div className="delivery-brandbar">
        <div className="delivery-brand"><div className="delivery-logo">{logoUrl ? <img src={logoUrl} alt="Logo de l’organisation"/> : <span>O</span>}</div><div><h1>{issuerName}</h1><p>{String(issuer.address ?? issuer.country ?? 'COTONOU - BÉNIN')}</p></div></div>
        <div className="delivery-platform-brand"><b>Rapports Scolaires 2026 – 2027</b><span>Gestion et suivi des cartes scolaires</span></div>
      </div>
      <div className="delivery-title-ribbon"><span>BORDEREAU DE LIVRAISON</span></div>
      <div className="delivery-document-meta">
        <div><span>Établissement :</span><b>{selectedSchool?.name ?? '—'}</b><span>Agent responsable :</span><b>{selectedSlip.responsible_agent ?? '—'}</b><span>Année scolaire :</span><b>{year?.label ?? '—'}</b></div>
        <div><span>N° Bordereau :</span><b className="delivery-number-pill">{selectedSlip.slip_number}</b><span>Date :</span><b>{new Date(selectedSlip.delivery_date).toLocaleDateString('fr-FR')}</b><span>Statut :</span><b>{statusLabels[selectedSlip.status]}</b></div>
      </div>
      <div className="delivery-lines-wrap"><table className="delivery-print-table"><thead><tr><th>N°</th><th>Groupes pédagogiques</th><th>Quantité livrée</th></tr></thead>
        {groupedLines.map(group => <tbody key={group.id}>
          {group.lines.map(({ line, groupName }, index) => <tr key={line.id}><td>{index + 1}</td><td>{groupName}</td><td>{line.quantity_delivered.toLocaleString('fr-FR')}</td></tr>)}
          <tr className="delivery-promotion-total"><td colSpan={2}>Total par promotion — {group.label}</td><td>{group.total.toLocaleString('fr-FR')}</td></tr>
        </tbody>)}
        <tfoot><tr><th colSpan={2}>TOTAL GÉNÉRAL</th><th>{total.toLocaleString('fr-FR')}</th></tr></tfoot>
      </table>{selectedLines.length === 0 && <p className="delivery-empty">Ajoutez au moins une ligne pour compléter le bordereau.</p>}</div>
      <div className="delivery-amount-words"><span>Arrête le présent Bordereau de Livraison à la quantité de</span><strong>{quantityInWords(total)} ({total.toLocaleString('fr-FR')}) cartes.</strong></div>
      {selectedSlip.observations && <p className="delivery-observations"><b>Observations :</b> {selectedSlip.observations}</p>}
      <div className="delivery-signatures">
        <section><h3>Établi par</h3><b className="delivery-person-name">{creatorName}</b><span>Signature</span><div className="delivery-sign-line"/></section>
        <section><h3>Visa de réception</h3><b>Nom et prénoms du réceptionnaire</b><div className="delivery-blank-line"/><b>Fonction</b><div className="delivery-blank-line"/><b>Date de réception</b><div className="delivery-blank-line"/><span>Signature</span><div className="delivery-sign-line"/></section>
        <section><h3>Cachet de l’établissement</h3><div className="delivery-stamp-box"/></section>
      </div>
    </section>}
    </div>}
  </div>;
}
