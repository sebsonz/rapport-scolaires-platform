import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import './SchoolPedagogicalClasses.css';

type Promotion = { id: string; code: string; label: string; cycle: string };
type Group = { id: string; promotion_id: string; is_active: boolean };

export default function SchoolPedagogicalClasses({
  schoolId, schoolName, yearId, yearLabel, promotions, groups, canConfigure, onSaved,
}: {
  schoolId: string;
  schoolName: string;
  yearId: string;
  yearLabel: string;
  promotions: Promotion[];
  groups: Group[];
  canConfigure: boolean;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activePromotionIds = useMemo(
    () => [...new Set(groups.filter(group => group.is_active).map(group => group.promotion_id))],
    [groups],
  );
  const activePromotions = useMemo(
    () => activePromotionIds.map(id => promotions.find(item => item.id === id)).filter((item): item is Promotion => !!item),
    [activePromotionIds, promotions],
  );

  useEffect(() => {
    setSelected(activePromotionIds);
  }, [activePromotionIds.join('|')]);

  async function saveSelection() {
    if (!supabase || !schoolId || !yearId || !canConfigure || busy) return;
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
        <small>{activePromotionIds.length} classe(s) active(s)</small>
      </div>
      <button type="button" className="gp-open" onClick={() => { setExpanded(value => !value); setError(''); setNotice(''); }}>
        {expanded ? 'Masquer la liste' : 'Voir les classes'} {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
      </button>
    </div>

    {notice && <div className="gp-message success">{notice}</div>}
    {error && <div className="gp-message error">{error}</div>}

    {expanded && <div className="gp-manager">
      {canConfigure ? <>
        <div className="gp-columns">
          <section className="gp-column gp-reference" aria-labelledby="gp-reference-title">
            <div className="gp-column-heading">
              <div>
                <span className="gp-step">RÉFÉRENTIEL NATIONAL</span>
                <h3 id="gp-reference-title">Classes de référence</h3>
                <p>Sélectionnez les classes qui existent dans cet établissement.</p>
              </div>
              <span className="gp-count">{selected.length} choisie(s)</span>
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
                    disabled={busy}
                  />
                  <span className="gp-class-name">{promotion.label}</span>
                  <small>{promotion.cycle}</small>
                </label>
              ))}
              {promotions.length === 0 && <div className="gp-empty">Aucune classe active dans le référentiel national.</div>}
            </div>
            <div className="gp-column-footer">
              <p>La configuration normale des classes relève de la Catégorie 1. Les retraits désactivent les GP sans supprimer leur historique.</p>
              <button type="button" onClick={() => void saveSelection()} disabled={busy}>
                {busy ? <RefreshCw className="gp-spin" size={15}/> : <Check size={15}/>}
                {busy ? 'Enregistrement…' : 'Enregistrer la sélection'}
              </button>
            </div>
          </section>

          <section className="gp-column gp-school" aria-labelledby="gp-school-title">
            <div className="gp-column-heading">
              <div>
                <span className="gp-step">ÉTABLISSEMENT</span>
                <h3 id="gp-school-title">Classes affectées / GP</h3>
                <p>Classes actives pour cet établissement et cette année.</p>
              </div>
              <span className="gp-count gp-count-school">{activePromotionIds.length} active(s)</span>
            </div>
            <div className="gp-school-list">
              {activePromotions.map(promotion => (
                <div className="gp-school-option" key={promotion.id}>
                  <span className="gp-school-check"><Check size={14}/></span>
                  <span className="gp-class-code">{promotion.code}</span>
                  <span className="gp-class-name">{promotion.label}</span>
                  <small>{promotion.cycle}</small>
                </div>
              ))}
              {activePromotionIds.length === 0 && (
                <div className="gp-school-empty">
                  <BookOpen size={23}/>
                  <b>Aucune classe affectée</b>
                  <span>Sélectionnez les classes dans le référentiel national, puis enregistrez.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </> : <>
        <section className="gp-column gp-school" aria-labelledby="gp-school-title">
          <div className="gp-column-heading">
            <div>
              <span className="gp-step">CONSULTATION PARTAGÉE</span>
              <h3 id="gp-school-title">Classes affectées à l’établissement</h3>
              <p>La Catégorie 2 retrouve ici les mêmes classes et les mêmes lignes de suivi que la Catégorie 1.</p>
            </div>
            <span className="gp-count gp-count-school">{activePromotionIds.length} active(s)</span>
          </div>
          <div className="gp-school-list">
            {activePromotions.map(promotion => (
              <div className="gp-school-option" key={promotion.id}>
                <span className="gp-school-check"><Check size={14}/></span>
                <span className="gp-class-code">{promotion.code}</span>
                <span className="gp-class-name">{promotion.label}</span>
                <small>{promotion.cycle}</small>
              </div>
            ))}
            {activePromotionIds.length === 0 && <div className="gp-school-empty"><BookOpen size={23}/><b>Aucune classe affectée</b><span>La Catégorie 1 doit configurer les classes avant la collecte.</span></div>}
          </div>
          <div className="gp-school-footnote">La configuration des classes est réservée à la Catégorie 1 dans le fonctionnement normal. La Catégorie 2 intervient sur les données de livraison des classes déjà affectées.</div>
        </section>
      </>}
    </div>}
  </section>;
}
