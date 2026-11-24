import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, FilePlus2, Printer, RefreshCw, Send, ShieldCheck, Truck } from 'lucide-react';
import { supabase } from './lib/supabase';

type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };
type School = { id: string; department_id: string; code: string; name: string };
type Year = { id: string; label: string; code: string };
type Promotion = { id: string; label: string; code: string };
type PedagogicalGroup = { id: string; school_id: string; school_year_id: string; promotion_id: string; group_code: string };
type Slip = {
  id: string; school_id: string; school_year_id: string; slip_number: string; delivery_date: string;
  status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'CANCELLED'; observations: string | null;
  responsible_agent: string | null; created_by: string; creator_role: string | null;
  validated_by: string | null; validated_at: string | null; organization_snapshot: Record<string, unknown> | null;
};
type Line = { id: string; delivery_slip_id: string; promotion_id: string; group_code: string; quantity_delivered: number };

const statusLabels: Record<Slip['status'], string> = {
  DRAFT: 'Brouillon', SUBMITTED: 'Soumis', VALIDATED: 'Validé', CANCELLED: 'Annulé',
};

export default function DeliverySlips({ memberships }: { memberships: Membership[] }) {
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

  useEffect(() => { void supabase?.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? '')); }, []);

  const selectedSchool = schools.find(item => item.id === schoolId);
  const availableRoles = useMemo(() => {
    if (isAdmin) return ['CENTRAL_ADMIN'] as const;
    return [...new Set(memberships.filter(item => item.department_id === selectedSchool?.department_id).map(item => item.role).filter(role => role === 'CATEGORY_1' || role === 'CATEGORY_2'))] as Array<'CATEGORY_1' | 'CATEGORY_2'>;
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
    const [groupResult, slipResult] = await Promise.all([
      supabase.from('pedagogical_groups').select('id,school_id,school_year_id,promotion_id,group_code')
        .eq('school_id', nextSchoolId).eq('school_year_id', nextYear.id).order('created_at'),
      supabase.from('delivery_slips').select('id,school_id,school_year_id,slip_number,delivery_date,status,observations,responsible_agent,created_by,creator_role,validated_by,validated_at,organization_snapshot')
        .eq('school_id', nextSchoolId).eq('school_year_id', nextYear.id).order('created_at', { ascending: false }),
    ]);
    if (groupResult.error || slipResult.error) {
      setError(groupResult.error?.message ?? slipResult.error?.message ?? 'Impossible de charger les bordereaux.');
      setLoading(false); return;
    }
    setGroups((groupResult.data ?? []) as PedagogicalGroup[]);
    const nextSlips = (slipResult.data ?? []) as Slip[];
    setSlips(nextSlips);
    const nextSelected = nextSlips.some(item => item.id === selectedSlipId) ? selectedSlipId : nextSlips[0]?.id ?? '';
    setSelectedSlipId(nextSelected);
    if (nextSelected) {
      const lineResult = await supabase.from('delivery_slip_lines')
        .select('id,delivery_slip_id,promotion_id,group_code,quantity_delivered')
        .eq('delivery_slip_id', nextSelected).order('created_at');
      if (lineResult.error) setError(lineResult.error.message);
      setLines((lineResult.data ?? []) as Line[]);
    } else setLines([]);
    setLoading(false);
  }, [schoolId, selectedSlipId]);

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
  const promotionLabel = (id: string) => promotions.find(item => item.id === id)?.label ?? promotions.find(item => item.id === id)?.code ?? 'Promotion';

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
    setQuantity(''); setNotice('Ligne ajoutée au bordereau.');
    await load();
  }

  async function transition(action: 'submit_delivery_slip' | 'validate_delivery_slip') {
    if (!supabase || !selectedSlipId) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc(action, { p_delivery_slip_id: selectedSlipId });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(action === 'validate_delivery_slip' ? 'Bordereau validé.' : 'Bordereau soumis.');
    await load();
  }

  const printSlip = () => window.print();

  return <div className="delivery-module">
    <div className="delivery-heading"><div><span className="delivery-eyebrow">GESTION DOCUMENTAIRE</span><h2><Truck/> Bordereaux de livraison</h2><p>Création, suivi, soumission et impression des bordereaux officiels.</p></div><button type="button" className="delivery-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Actualiser</button></div>
    {error && <div className="delivery-alert error">{error}</div>}
    {notice && <div className="delivery-alert success"><CheckCircle2 size={16}/>{notice}</div>}
    <div className="delivery-layout">
      <section className="delivery-panel">
        <h3><FilePlus2 size={17}/> Nouveau bordereau</h3>
        <form className="delivery-form" onSubmit={createSlip}>
          <label>Établissement<select required value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">Choisir un établissement</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
          <label>Année scolaire<input value={year?.label ?? 'Aucune année active'} readOnly/></label>
          <label>Rôle émetteur<select value={creatorRole} onChange={event => setCreatorRole(event.target.value as typeof creatorRole)} disabled={availableRoles.length <= 1}><option value="CENTRAL_ADMIN">Administration centrale</option><option value="CATEGORY_1">Catégorie 1</option><option value="CATEGORY_2">Catégorie 2</option></select></label>
          <label>Numéro du bordereau<input value={number} onChange={event => setNumber(event.target.value)} required maxLength={60} placeholder="Ex. BL-2026-001"/></label>
          <label>Date de livraison<input type="date" value={date} onChange={event => setDate(event.target.value)} required/></label>
          <label>Agent responsable<input value={agent} onChange={event => setAgent(event.target.value)} maxLength={160} placeholder="Nom de l’agent"/></label>
          <label className="wide">Observations<textarea value={observations} onChange={event => setObservations(event.target.value)} rows={2}/></label>
          <button className="delivery-primary wide" type="submit" disabled={busy || !year || !schoolId || availableRoles.length === 0}>{busy ? 'Création…' : 'Créer le bordereau'}</button>
        </form>
      </section>
      <section className="delivery-panel">
        <h3>Historique des bordereaux <span>{slips.length}</span></h3>
        <label className="delivery-school-filter">Établissement<select value={schoolId} onChange={event => { setSchoolId(event.target.value); setSelectedSlipId(''); }}><option value="">Choisir</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="delivery-slip-list">{slips.map(item => <button type="button" key={item.id} className={item.id === selectedSlipId ? 'selected' : ''} onClick={() => setSelectedSlipId(item.id)}><span><b>{item.slip_number}</b><small>{new Date(item.delivery_date).toLocaleDateString('fr-FR')} · {item.creator_role ?? 'Ancien bordereau'}</small></span><em className={'status '+item.status.toLowerCase()}>{statusLabels[item.status]}</em></button>)}{slips.length === 0 && <p className="delivery-empty">Aucun bordereau pour cet établissement et cette année.</p>}</div>
      </section>
    </div>
    {selectedSlip && <section className="delivery-panel delivery-document" id="delivery-print">
      <div className="delivery-document-head"><div><span className="delivery-eyebrow">BORDEREAU DE LIVRAISON</span><h2>{String(selectedSlip.organization_snapshot?.legal_name ?? selectedSlip.organization_snapshot?.short_name ?? 'Émetteur')}</h2><p>{String(selectedSlip.organization_snapshot?.address ?? '')}</p></div><div className="delivery-number"><b>{selectedSlip.slip_number}</b><span>{new Date(selectedSlip.delivery_date).toLocaleDateString('fr-FR')}</span></div></div>
      <div className="delivery-document-meta"><span>Établissement : <b>{selectedSchool?.name ?? '—'}</b></span><span>Année : <b>{year?.label ?? '—'}</b></span><span>Agent : <b>{selectedSlip.responsible_agent ?? '—'}</b></span><span>Statut : <b>{statusLabels[selectedSlip.status]}</b></span></div>
      <div className="delivery-lines-wrap"><table><thead><tr><th>Promotion</th><th>Groupe</th><th>Quantité livrée</th></tr></thead><tbody>{selectedLines.map(line=><tr key={line.id}><td>{promotionLabel(line.promotion_id)}</td><td>{line.group_code}</td><td>{line.quantity_delivered.toLocaleString('fr-FR')}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><th>{selectedLines.reduce((sum,line)=>sum+line.quantity_delivered,0).toLocaleString('fr-FR')}</th></tr></tfoot></table>{selectedLines.length===0&&<p className="delivery-empty">Ajoutez au moins une ligne pour compléter le bordereau.</p>}</div>
      {selectedSlip.observations && <p className="delivery-observations"><b>Observations :</b> {selectedSlip.observations}</p>}
      <div className="delivery-signatures"><div>Établi par<br/><b>{selectedSlip.creator_role === 'CATEGORY_1' ? 'Catégorie 1' : selectedSlip.creator_role === 'CATEGORY_2' ? 'Catégorie 2' : 'Administration centrale'}</b></div><div>Visa / validation<br/><b>{selectedSlip.validated_at ? new Date(selectedSlip.validated_at).toLocaleString('fr-FR') : selectedSlip.creator_role === 'CATEGORY_2' ? 'En attente de validation administrative' : 'Non requise'}</b></div></div>
      <div className="delivery-actions no-print">
        {selectedSlip.status === 'DRAFT' && <form className="delivery-add-line" onSubmit={addLine}><select value={groupId} onChange={event=>setGroupId(event.target.value)} required><option value="">Choisir une classe / groupe</option>{groups.map(group=><option key={group.id} value={group.id}>{promotionLabel(group.promotion_id)} · {group.group_code}</option>)}</select><input type="number" min="0" step="1" value={quantity} onChange={event=>setQuantity(event.target.value)} required placeholder="Quantité"/><button className="delivery-primary" disabled={busy || !canManageSelected}>Ajouter la ligne</button></form>}
        {selectedSlip.status === 'DRAFT' && <button className="delivery-primary" onClick={()=>void transition('submit_delivery_slip')} disabled={busy || selectedLines.length===0}><Send size={15}/> Soumettre</button>}
        {canValidate && <button className="delivery-primary validate" onClick={()=>void transition('validate_delivery_slip')} disabled={busy}><ShieldCheck size={15}/> Valider (administration)</button>}
        <button className="delivery-secondary" onClick={printSlip}><Printer size={15}/> Imprimer / PDF</button>
      </div>
    </section>}
  </div>;
}
