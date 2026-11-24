import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import './SchoolPedagogicalClasses.css';

type Promotion = { id: string; code: string; label: string; cycle: string };
type Group = { id: string; promotion_id: string; is_active: boolean };
type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };

export default function SchoolPedagogicalClasses({
  schoolId, schoolName, yearId, yearLabel, promotions, groups, memberships, onSaved,
}: {
  schoolId: string;
  schoolName: string;
  yearId: string;
  yearLabel: string;
  promotions: Promotion[];
  groups: Group[];
  memberships: Membership[];
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canConfigure = memberships.some(item =>
    item.role === 'CENTRAL_ADMIN' || (item.role === 'CATEGORY_1' && item.department_id),
  );
  const activePromotionIds = useMemo(
    () => [...new Set(groups.filter(group => group.is_active).map(group => group.promotion_id))],
    [groups],
  );

  useEffect(() => {
    setSelected(activePromotionIds);
  }, [activePromotionIds.join('|')]);

  async function saveSelection() {
    if (!supabase || !schoolId || !yearId || !canConfigure) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { error: saveError } = await supabase.rpc('set_school_pedagogical_classes', {
      p_school_id: schoolId,
      p_school_year_id: yearId,
      p_promotion_ids: selected,
    });
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setNotice('La sélection des groupes pédagogiques a été enregistrée.');
    setExpanded(false);
    onSaved();
  }

  return <section className="gp-card" aria-labelledby="gp-title">
    <div className="gp-card-main">
      <div className="gp-icon"><BookOpen size={22}/></div>
      <div className="gp-copy">
        <h2 id="gp-title">Groupes pédagogiques (GP)</h2>
        <p>{schoolName} · {yearLabel || 'Année scolaire active'}</p>
        <small>{activePromotionIds.length} classe(s) sélectionnée(s)</small>
      </div>
      <button type="button" className="gp-open" onClick={() => { setExpanded(value => !value); setError(''); setNotice(''); }}>
        {expanded ? 'Fermer' : 'Gérer les GP'} {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
      </button>
    </div>

    {notice && <div className="gp-message success">{notice}</div>}
    {error && <div className="gp-message error">{error}</div>}

    {expanded && <div className="gp-manager">
      <div className="gp-manager-heading">
        <div><b>Classes du référentiel national</b><p>Cochez uniquement les classes présentes dans cet établissement.</p></div>
        <span>{selected.length} sélectionnée(s)</span>
      </div>
      <div className="gp-class-list">
        {promotions.map(promotion => (
          <label className="gp-class-option" key={promotion.id}>
            <input
              type="checkbox"
              checked={selected.includes(promotion.id)}
              onChange={event => setSelected(current =>
                event.target.checked
                  ? [...current, promotion.id]
                  : current.filter(id => id !== promotion.id)
              )}
              disabled={!canConfigure || busy}
            />
            <span className="gp-class-code">{promotion.code}</span>
            <span className="gp-class-name">{promotion.label}</span>
            <small>{promotion.cycle}</small>
          </label>
        ))}
        {promotions.length === 0 && <div className="gp-empty">Aucune classe active dans le référentiel national.</div>}
      </div>
      <div className="gp-manager-footer">
        <p>Un GP correspond à une classe. Le retrait désactive la classe sans supprimer ses rapports ni son historique.</p>
        <button type="button" onClick={() => void saveSelection()} disabled={!canConfigure || busy}>
          {busy ? <RefreshCw className="gp-spin" size={15}/> : <Check size={15}/>}
          {busy ? 'Enregistrement…' : 'Enregistrer la sélection'}
        </button>
      </div>
      {!canConfigure && <div className="gp-readonly">Consultation seule : la gestion des GP est réservée à la Catégorie 1.</div>}
    </div>}
  </section>;
}
