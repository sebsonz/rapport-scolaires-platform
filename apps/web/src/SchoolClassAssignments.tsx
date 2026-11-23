import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Check, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import './SchoolClassAssignments.css';

type Membership = { department_id: string | null; role: 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2' };
type Department = { id: string; name: string; code: string };
type School = { id: string; department_id: string; code: string; name: string; is_active: boolean };
type SchoolYear = { id: string; code: string; label: string; is_active: boolean };
type Promotion = { id: string; code: string; label: string; cycle: string; display_order: number; is_active: boolean };
type PedagogicalGroup = { id: string; school_id: string; school_year_id: string; promotion_id: string; group_code: string; created_at: string };

export default function SchoolClassAssignments({ memberships }: { memberships: Membership[] }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [groups, setGroups] = useState<PedagogicalGroup[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [yearId, setYearId] = useState('');
  const [promotionId, setPromotionId] = useState('');
  const [groupCode, setGroupCode] = useState('UNIQUE');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isCentralAdmin = memberships.some(item => item.role === 'CENTRAL_ADMIN');
  const departmentIds = useMemo(
    () => [...new Set(memberships.filter(item => item.department_id && item.role !== 'CENTRAL_ADMIN').map(item => item.department_id as string))],
    [memberships],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const [deptResult, schoolResult, yearResult, promotionResult, groupResult] = await Promise.all([
      supabase.from('departments').select('id,name,code').order('name'),
      supabase.from('schools').select('id,department_id,code,name,is_active').eq('is_active', true).order('name'),
      supabase.from('school_years').select('id,code,label,is_active').eq('is_active', true).order('starts_on', { ascending: false }),
      supabase.from('promotions').select('id,code,label,cycle,display_order,is_active').eq('is_active', true).order('display_order').order('label'),
      supabase.from('pedagogical_groups').select('id,school_id,school_year_id,promotion_id,group_code,created_at').order('created_at', { ascending: false }),
    ]);
    const firstError = deptResult.error ?? schoolResult.error ?? yearResult.error ?? promotionResult.error ?? groupResult.error;
    if (firstError) setError(firstError.message);
    const nextSchools = ((schoolResult.data ?? []) as School[]).filter(item => isCentralAdmin || departmentIds.includes(item.department_id));
    setDepartments((deptResult.data ?? []) as Department[]);
    setSchools(nextSchools);
    setYears((yearResult.data ?? []) as SchoolYear[]);
    setPromotions((promotionResult.data ?? []) as Promotion[]);
    setGroups((groupResult.data ?? []) as PedagogicalGroup[]);
    setSchoolId(current => nextSchools.some(item => item.id === current) ? current : (nextSchools[0]?.id ?? ''));
    setYearId(current => (yearResult.data ?? []).some((item: any) => item.id === current) ? current : ((yearResult.data?.[0] as SchoolYear | undefined)?.id ?? ''));
    setPromotionId(current => (promotionResult.data ?? []).some((item: any) => item.id === current) ? current : ((promotionResult.data?.[0] as Promotion | undefined)?.id ?? ''));
    setLoading(false);
  }, [departmentIds, isCentralAdmin]);

  useEffect(() => { void load(); }, [load]);

  const departmentById = useMemo(() => new Map(departments.map(item => [item.id, item])), [departments]);
  const schoolById = useMemo(() => new Map(schools.map(item => [item.id, item])), [schools]);
  const promotionById = useMemo(() => new Map(promotions.map(item => [item.id, item])), [promotions]);
  const visibleGroups = useMemo(
    () => groups.filter(item => item.school_id === schoolId && item.school_year_id === yearId),
    [groups, schoolId, yearId],
  );
  const selectedSchool = schoolById.get(schoolId);
  const canConfigureSelected = !!selectedSchool && memberships.some(item =>
    item.department_id === selectedSchool.department_id && (item.role === 'CATEGORY_1' || item.role === 'CENTRAL_ADMIN'),
  );

  async function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !schoolId || !yearId || !promotionId) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('category1_add_school_class_group', {
      p_school_id: schoolId,
      p_school_year_id: yearId,
      p_promotion_id: promotionId,
      p_group_code: groupCode.trim().toUpperCase(),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice('Classe ajoutée au rapport de l’établissement.');
    setGroupCode('UNIQUE');
    await load();
  }

  return <section className="school-class-panel">
    <div className="school-class-heading">
      <div><h2>Classes de l’établissement</h2><p>Sélectionnez les classes réellement présentes dans le rapport, depuis le catalogue national.</p></div>
      <button className="school-class-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Actualiser</button>
    </div>
    {error && <div className="school-class-message error">{error}</div>}
    {notice && <div className="school-class-message success">{notice}</div>}
    {loading ? <div className="school-class-empty"><RefreshCw className="spin"/> Chargement…</div>
      : schools.length === 0 ? <div className="school-class-empty">Aucun établissement actif n’est disponible dans les départements affectés à ce compte.</div>
      : <>
        <div className="school-class-filters">
          <label><span>Établissement</span><select value={schoolId} onChange={event => setSchoolId(event.target.value)}>{schools.map(item => <option key={item.id} value={item.id}>{item.name} · {departmentById.get(item.department_id)?.name ?? item.code}</option>)}</select></label>
          <label><span>Année scolaire</span><select value={yearId} onChange={event => setYearId(event.target.value)}>{years.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        </div>
        {canConfigureSelected && <form className="school-class-add" onSubmit={addGroup}>
          <label><span>Classe du catalogue national</span><select value={promotionId} onChange={event => setPromotionId(event.target.value)} required>{promotions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.label} ({item.cycle})</option>)}</select></label>
          <label><span>Groupe pédagogique</span><input value={groupCode} onChange={event => setGroupCode(event.target.value.toUpperCase())} maxLength={30} required placeholder="Ex. A, B ou UNIQUE"/></label>
          <button type="submit" disabled={busy || !yearId || !promotionId}><Check size={15}/>{busy ? 'Enregistrement…' : 'Ajouter la classe'}</button>
        </form>}
        {!canConfigureSelected && <div className="school-class-readonly">Consultation seule : la configuration des classes est réservée à la Catégorie 1 du département de cet établissement.</div>}
        <div className="school-class-list-head"><div><h3>Classes configurées</h3><p>{visibleGroups.length} groupe(s) pédagogique(s) pour cette année</p></div></div>
        {visibleGroups.length === 0 ? <div className="school-class-empty">Aucune classe n’a encore été ajoutée pour cet établissement et cette année scolaire.</div>
          : <div className="school-class-table-wrap"><table><thead><tr><th>Code classe</th><th>Classe</th><th>Cycle</th><th>Groupe</th><th>Département</th></tr></thead><tbody>
            {visibleGroups.map(item => {
              const promotion = promotionById.get(item.promotion_id);
              return <tr key={item.id}><td><b>{promotion?.code ?? '—'}</b></td><td>{promotion?.label ?? 'Classe du catalogue'}</td><td>{promotion?.cycle ?? '—'}</td><td>{item.group_code}</td><td>{selectedSchool ? departmentById.get(selectedSchool.department_id)?.name ?? '—' : '—'}</td></tr>;
            })}
          </tbody></table></div>}
      </>}
    <div className="school-class-footnote"><BookOpen size={14}/> Les classes et groupes déjà utilisés dans les rapports sont conservés pour l’historique, même si le catalogue national évolue.</div>
  </section>;
}
