import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

type AdminSlip = {
  id: string;
  slip_number: string;
  delivery_date: string;
  status: string;
  school_id: string;
  school_year_id: string;
  observations: string | null;
  responsible_agent: string | null;
};
type AdminGroup = { id: string; promotion_id: string; group_code: string; promotion_label: string };
type AdminLine = {
  id?: string;
  promotion_id: string;
  group_code: string;
  quantity_delivered: number;
  source_pedagogical_group_id?: string | null;
};

export default function DeliverySlipAdminTools({
  slip, lines, isAdmin, onRefresh,
}: {
  slip: AdminSlip;
  lines: AdminLine[];
  isAdmin: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(slip.slip_number);
  const [date, setDate] = useState(slip.delivery_date);
  const [agent, setAgent] = useState(slip.responsible_agent ?? '');
  const [observations, setObservations] = useState(slip.observations ?? '');
  const [draftLines, setDraftLines] = useState<AdminLine[]>(lines);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [newGroupId, setNewGroupId] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('pedagogical_groups')
      .select('id,promotion_id,group_code,promotions(label)')
      .eq('school_id', slip.school_id).eq('school_year_id', slip.school_year_id)
      .order('group_code')
      .then(({ data }) => setGroups((data ?? []).map((item: any) => ({
        id: item.id, promotion_id: item.promotion_id, group_code: item.group_code,
        promotion_label: item.promotions?.label ?? item.promotion_id,
      }))));
  }, [slip.id, slip.school_id, slip.school_year_id]);

  useEffect(() => {
    setEditing(false);
    setNumber(slip.slip_number);
    setDate(slip.delivery_date);
    setAgent(slip.responsible_agent ?? '');
    setObservations(slip.observations ?? '');
    setDraftLines(lines);
    setError('');
  }, [slip.id, slip.slip_number, slip.delivery_date, slip.status, lines]);

  if (!isAdmin) return null;

  async function runTransition(action: 'CANCEL' | 'ARCHIVE') {
    if (!supabase) { setError('Connexion Supabase indisponible.'); return; }
    const reason = window.prompt(action === 'CANCEL'
      ? 'Motif obligatoire de l’annulation :'
      : 'Motif obligatoire de l’archivage :');
    if (reason === null) return;
    if (!reason.trim()) { setError('Le motif est obligatoire.'); return; }
    if (!window.confirm(action === 'CANCEL'
      ? 'Annuler ce bordereau ? Ses quantités seront réinjectées dans le calcul.'
      : 'Archiver ce bordereau ? Ses quantités continueront à compter dans le cumul.')) return;
    setBusy(true); setError('');
    const { error: rpcError } = await supabase!.rpc('admin_transition_delivery_slip', {
      p_delivery_slip_id: slip.id, p_action: action, p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    await onRefresh();
  }

  async function remove() {
    if (!supabase) { setError('Connexion Supabase indisponible.'); return; }
    const reason = window.prompt('Motif obligatoire de la suppression définitive :');
    if (reason === null) return;
    if (!reason.trim()) { setError('Le motif est obligatoire.'); return; }
    if (!window.confirm('Supprimer définitivement ce bordereau ? Une copie complète sera conservée dans le journal d’audit.')) return;
    setBusy(true); setError('');
    const { error: rpcError } = await supabase!.rpc('admin_delete_delivery_slip', {
      p_delivery_slip_id: slip.id, p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    await onRefresh();
  }

  async function save() {
    if (!supabase) { setError('Connexion Supabase indisponible.'); return; }
    if (!number.trim() || !date || !draftLines.length) {
      setError('Le numéro, la date et au moins une ligne sont obligatoires.'); return;
    }
    if (draftLines.some(line => !Number.isInteger(Number(line.quantity_delivered)) || Number(line.quantity_delivered) < 0)) {
      setError('Chaque quantité doit être un entier positif ou nul.'); return;
    }
    const reason = window.prompt('Motif obligatoire de la correction administrative :');
    if (reason === null) return;
    if (!reason.trim()) { setError('Le motif est obligatoire.'); return; }
    setBusy(true); setError('');
    const { error: rpcError } = await supabase!.rpc('admin_update_delivery_slip', {
      p_delivery_slip_id: slip.id,
      p_slip_number: number.trim(),
      p_delivery_date: date,
      p_observations: observations.trim() || null,
      p_responsible_agent: agent.trim() || null,
      p_lines: draftLines.map(line => ({
        promotion_id: line.promotion_id,
        group_code: line.group_code,
        quantity_delivered: Number(line.quantity_delivered),
        source_pedagogical_group_id: line.source_pedagogical_group_id ?? null,
      })),
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setEditing(false);
    await onRefresh();
  }

  return (
    <section className="delivery-panel" style={{ marginTop: 16 }}>
      <h3>Administration centrale · Gestion du bordereau</h3>
      <p>Les corrections sont possibles quel que soit le statut. Toute opération exige un motif et laisse une trace d’audit.</p>
      {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
      {editing ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <label>Numéro<input value={number} onChange={e => setNumber(e.target.value)} /></label>
          <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Agent responsable<input value={agent} onChange={e => setAgent(e.target.value)} /></label>
          <label>Observations<textarea value={observations} onChange={e => setObservations(e.target.value)} rows={2} /></label>
          <b>Quantités par ligne</b>
          {draftLines.map((line, index) => (
            <div key={line.id ?? index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px auto', gap: 8, alignItems: 'center' }}>
              <span>{line.group_code} · {line.promotion_id}</span>
              <input aria-label={'Quantité ' + line.group_code} type="number" min="0" step="1"
                value={line.quantity_delivered}
                onChange={e => setDraftLines(current => current.map((item, i) => i === index
                  ? { ...item, quantity_delivered: Number(e.target.value) } : item))} />
              <button type="button" onClick={() => setDraftLines(current => current.filter((_, i) => i !== index))}>Retirer</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px auto', gap: 8, alignItems: 'end' }}>
            <label>Ajouter un groupe
              <select value={newGroupId} onChange={e => setNewGroupId(e.target.value)}>
                <option value="">Choisir un groupe pédagogique</option>
                {groups.filter(group => !draftLines.some(line => line.promotion_id === group.promotion_id && line.group_code === group.group_code))
                  .map(group => <option key={group.id} value={group.id}>{group.promotion_label} · {group.group_code}</option>)}
              </select>
            </label>
            <label>Quantité<input type="number" min="1" step="1" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} /></label>
            <button type="button" disabled={!newGroupId || !Number.isInteger(Number(newQuantity)) || Number(newQuantity) <= 0}
              onClick={() => {
                const group = groups.find(item => item.id === newGroupId);
                if (!group) return;
                setDraftLines(current => [...current, {
                  promotion_id: group.promotion_id, group_code: group.group_code,
                  quantity_delivered: Number(newQuantity), source_pedagogical_group_id: group.id,
                }]);
                setNewGroupId(''); setNewQuantity('');
              }}>Ajouter la ligne</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={() => void save()}>Enregistrer la correction</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>Fermer</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || !lines.length} onClick={() => setEditing(true)}>Modifier le bordereau</button>
          {slip.status !== 'CANCELLED' && <button type="button" disabled={busy} onClick={() => void runTransition('CANCEL')}>Annuler et réinjecter les quantités</button>}
          {slip.status !== 'CANCELLED' && slip.status !== 'ARCHIVED' && <button type="button" disabled={busy} onClick={() => void runTransition('ARCHIVE')}>Archiver (conserver au cumul)</button>}
          <button type="button" disabled={busy} onClick={() => void remove()}>Supprimer définitivement</button>
        </div>
      )}
    </section>
  );
}
