import { useCallback,useEffect,useMemo,useState,type FormEvent } from 'react';
import { AlertTriangle,CheckCircle2,Printer,RefreshCw,Sparkles,Truck } from 'lucide-react';
import { supabase } from './lib/supabase';
import './AutomaticDeliverySlips.css';

type Membership={department_id:string|null;role:'CENTRAL_ADMIN'|'CATEGORY_1'|'CATEGORY_2'};
type School={id:string;department_id:string;code:string;name:string};
type Year={id:string;label:string;code:string};
type Candidate={pedagogical_group_id:string;promotion_id:string;promotion_label:string;group_code:string;current_delivered:number;already_slipped:number;available_to_slip:number;has_report:boolean};
type Slip={id:string;school_id:string;school_year_id:string;slip_number:string;delivery_date:string;status:'DRAFT'|'SUBMITTED'|'VALIDATED'|'CANCELLED';observations:string|null;responsible_agent:string|null;creator_full_name:string|null;organization_snapshot:Record<string,unknown>|null};
type SlipLine={id:string;promotion_id:string;group_code:string;quantity_delivered:number};
const statusLabels:Record<Slip['status'],string>={DRAFT:'Brouillon',SUBMITTED:'Soumis',VALIDATED:'Validé',CANCELLED:'Annulé'};
const classLabel=(label:string,code:string)=>code.trim().toUpperCase()==='UNIQUE'?label:(label.match(/^(.*?)[\s-]+(M\d+)$/i)?label.replace(/^(.*?)[\s-]+(M\d+)$/i,'$1')+' '+code:label+' '+code);

export default function AutomaticDeliverySlips({memberships}:{memberships:Membership[]}) {
 const isAdmin=memberships.some(x=>x.role==='CENTRAL_ADMIN');
 const [schools,setSchools]=useState<School[]>([]),[year,setYear]=useState<Year|null>(null),[schoolId,setSchoolId]=useState('');
 const [candidates,setCandidates]=useState<Candidate[]>([]),[selectedIds,setSelectedIds]=useState<string[]>([]);
 const [history,setHistory]=useState<Slip[]>([]),[selectedSlip,setSelectedSlip]=useState<Slip|null>(null),[slipLines,setSlipLines]=useState<SlipLine[]>([]);
 const [number,setNumber]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[agent,setAgent]=useState(''),[observations,setObservations]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const school=schools.find(x=>x.id===schoolId);
 const canGenerate=!!school&&(isAdmin||memberships.some(x=>x.department_id===school.department_id&&x.role==='CATEGORY_2'));
 const fmt=(n:number)=>Number(n).toLocaleString('fr-FR');
 const refresh=useCallback(async()=>{
  if(!supabase||!schoolId||!year){setCandidates([]);setSelectedIds([]);return;}
  setLoading(true);setError('');
  const {data,error:rpcError}=await supabase.rpc('get_automatic_delivery_slip_candidates',{p_school_id:schoolId,p_school_year_id:year.id});
  if(rpcError){setError(rpcError.message);setCandidates([]);setSelectedIds([]);}
  else {const rows=(data??[]) as Candidate[];setCandidates(rows);setSelectedIds(rows.filter(x=>x.available_to_slip>0).map(x=>x.pedagogical_group_id));}
  const {data:slips,error:slipError}=await supabase.from('delivery_slips').select('id,school_id,school_year_id,slip_number,delivery_date,status,observations,responsible_agent,creator_full_name,organization_snapshot').eq('school_id',schoolId).eq('school_year_id',year.id).eq('creation_mode','AUTOMATIC').order('created_at',{ascending:false});
  if(slipError)setError(slipError.message);else setHistory((slips??[]) as Slip[]);
  setLoading(false);
 },[schoolId,year]);
 useEffect(()=>{if(!supabase)return;void Promise.all([
  supabase.from('schools').select('id,department_id,code,name').eq('is_active',true).order('name'),
  supabase.from('school_years').select('id,label,code').eq('is_active',true).limit(1).maybeSingle()
 ]).then(([s,y])=>{if(s.error||y.error){setError(s.error?.message??y.error?.message??'Erreur de chargement');setLoading(false);return;}
  const list=(s.data??[]) as School[];setSchools(list);setYear((y.data??null) as Year|null);setSchoolId(list[0]?.id??'');setLoading(false);
 });},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const chosen=useMemo(()=>candidates.filter(x=>selectedIds.includes(x.pedagogical_group_id)&&x.available_to_slip>0),[candidates,selectedIds]);
 const total=chosen.reduce((n,x)=>n+x.available_to_slip,0),anomalies=candidates.filter(x=>x.available_to_slip<0);
 const toggle=(id:string,on:boolean)=>setSelectedIds(s=>on?[...s,id]:s.filter(x=>x!==id));
 async function openSlip(s:Slip){
  if(!supabase)return;setSelectedSlip(s);
  const {data,error:e}=await supabase.from('delivery_slip_lines').select('id,promotion_id,group_code,quantity_delivered').eq('delivery_slip_id',s.id).order('created_at');
  if(e){setError(e.message);setSlipLines([]);}else setSlipLines((data??[]) as SlipLine[]);
 }
 async function generate(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!supabase||!schoolId||!year||!canGenerate||!selectedIds.length)return;
  setBusy(true);setError('');setNotice('');
  const {data,error:e2}=await supabase.rpc('create_automatic_delivery_slip',{p_school_id:schoolId,p_school_year_id:year.id,p_slip_number:number.trim(),p_delivery_date:date,p_group_ids:selectedIds,p_observations:observations.trim()||null,p_responsible_agent:agent.trim()||null});
  setBusy(false);if(e2){setError(e2.message);return;}
  setNumber('');setAgent('');setObservations('');setNotice('Bordereau automatique créé. Les quantités ont été réservées dans son historique.');
  await refresh();if(data)await openSlip(data as Slip);
 }
 const print=()=>{document.body.classList.add('automatic-delivery-print-mode');const done=()=>document.body.classList.remove('automatic-delivery-print-mode');window.addEventListener('afterprint',done,{once:true});window.print();};
 const selectedSchool=school;
 return <div className="automatic-delivery-module">
  <div className="automatic-delivery-heading"><div><span className="automatic-delivery-eyebrow">NOUVEAU MODE · SANS RESSAISIE</span><h2><Sparkles size={20}/> Bordereau automatique</h2><p>Effectif livré actuel moins le cumul déjà bordereauté. Les classes exclues restent disponibles.</p></div><button type="button" className="automatic-delivery-secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15}/> Actualiser</button></div>
  {error&&<div className="automatic-delivery-alert error"><AlertTriangle size={16}/>{error}</div>}{notice&&<div className="automatic-delivery-alert success"><CheckCircle2 size={16}/>{notice}</div>}
  <div className="automatic-delivery-grid">
   <section className="automatic-delivery-panel"><h3><Truck size={17}/> Préparer le prochain bordereau</h3>
    <form className="automatic-delivery-form" onSubmit={generate}>
     <label className="wide">Établissement<select value={schoolId} onChange={e=>{setSchoolId(e.target.value);setSelectedSlip(null);setSlipLines([]);}} required><option value="">Choisir un établissement</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
     <label>Année scolaire<input readOnly value={year?.label??'Aucune année active'}/></label>
     <label>Numéro du bordereau<input required maxLength={60} value={number} onChange={e=>setNumber(e.target.value)} placeholder="Ex. BOR-AUTO-2026-002"/></label>
     <label>Date de livraison<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
     <label>Agent responsable<input value={agent} onChange={e=>setAgent(e.target.value)} maxLength={160}/></label>
     <label className="wide">Observations<textarea rows={2} value={observations} onChange={e=>setObservations(e.target.value)}/></label>
     <div className="automatic-delivery-selection wide"><div><b>Classes à inclure</b><small>Décochez une classe pour la garder pour un prochain bordereau.</small></div><div><button type="button" onClick={()=>setSelectedIds(candidates.filter(x=>x.available_to_slip>0).map(x=>x.pedagogical_group_id))}>Tout sélectionner</button><button type="button" onClick={()=>setSelectedIds([])}>Tout exclure</button></div></div>
     <div className="automatic-delivery-candidates wide">{candidates.map(x=>{const bad=x.available_to_slip<0;return <label className={'automatic-delivery-candidate'+(bad?' anomaly':'')} key={x.pedagogical_group_id}>
      <input type="checkbox" checked={selectedIds.includes(x.pedagogical_group_id)} disabled={bad||x.available_to_slip===0} onChange={e=>toggle(x.pedagogical_group_id,e.target.checked)}/>
      <span><b>{classLabel(x.promotion_label,x.group_code)}</b><small>Livré actuel : {fmt(x.current_delivered)} · Déjà bordereauté : {fmt(x.already_slipped)}</small></span><strong>{fmt(x.available_to_slip)}</strong>{bad&&<em>Anomalie : vérifier l’historique</em>}{!bad&&x.available_to_slip===0&&<em>À jour</em>}
     </label>;})}{!candidates.length&&<p className="automatic-delivery-empty">Aucune classe avec rapport enregistré.</p>}</div>
     {anomalies.length>0&&<div className="automatic-delivery-warning wide"><AlertTriangle size={16}/>{anomalies.length} classe(s) bloquée(s) : le cumul bordereauté dépasse l’effectif livré actuel.</div>}
     <div className="automatic-delivery-total wide"><span>Total sélectionné</span><b>{fmt(total)}</b></div>
     <button className="automatic-delivery-primary wide" disabled={busy||loading||!canGenerate||!year||!selectedIds.length||total<=0}>{busy?'Génération…':'Générer le bordereau automatique'}</button>
     {!canGenerate&&school&&<p className="automatic-delivery-hint wide">Réservé à la Catégorie 2 ou à l’administration centrale.</p>}
    </form>
   </section>
   <section className="automatic-delivery-panel"><h3>Historique automatique <span>{history.length}</span></h3><div className="automatic-delivery-history">
    {history.map(s=><button type="button" key={s.id} className={selectedSlip?.id===s.id?'selected':''} onClick={()=>void openSlip(s)}><span><b>{s.slip_number}</b><small>{new Date(s.delivery_date).toLocaleDateString('fr-FR')}</small></span><em>{statusLabels[s.status]}</em></button>)}
    {!history.length&&<p className="automatic-delivery-empty">Aucun bordereau automatique enregistré.</p>}
   </div>{selectedSlip&&<div className="automatic-delivery-selected"><b>{selectedSlip.slip_number} · {selectedSlip.creator_full_name??'Créateur non renseigné'}</b><button type="button" className="automatic-delivery-secondary" onClick={print} disabled={!slipLines.length}><Printer size={15}/> Imprimer / PDF</button></div>}</section>
  </div>
  {selectedSlip&&<section className="delivery-document automatic-delivery-print-document"><div className="delivery-brandbar"><div className="delivery-brand"><div className="delivery-logo"><span>O</span></div><div><h1>{String(selectedSlip.organization_snapshot?.legal_name??selectedSlip.organization_snapshot?.short_name??'OMICROME')}</h1><p>{String(selectedSlip.organization_snapshot?.address??selectedSlip.organization_snapshot?.country??'COTONOU - BÉNIN')}</p></div></div><div className="delivery-platform-brand"><b>Rapports Scolaires 2026 – 2027</b><span>Gestion et suivi des cartes scolaires</span></div></div>
   <div className="delivery-title-ribbon"><span>BORDEREAU DE LIVRAISON AUTOMATIQUE</span></div><div className="delivery-document-meta"><div><span>Établissement :</span><b>{selectedSchool?.name??'—'}</b><span>Agent responsable :</span><b>{selectedSlip.responsible_agent??'—'}</b><span>Année scolaire :</span><b>{year?.label??'—'}</b></div><div><span>N° Bordereau :</span><b className="delivery-number-pill">{selectedSlip.slip_number}</b><span>Date :</span><b>{new Date(selectedSlip.delivery_date).toLocaleDateString('fr-FR')}</b><span>Statut :</span><b>{statusLabels[selectedSlip.status]}</b></div></div>
   <table className="delivery-print-table"><thead><tr><th>N°</th><th>Groupes pédagogiques</th><th>Nouvelle quantité livrée</th></tr></thead><tbody>{slipLines.map((l,i)=><tr key={l.id}><td>{i+1}</td><td>{classLabel(candidates.find(x=>x.promotion_id===l.promotion_id)?.promotion_label??'Classe',l.group_code)}</td><td>{fmt(l.quantity_delivered)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>TOTAL GÉNÉRAL</th><th>{fmt(slipLines.reduce((n,l)=>n+l.quantity_delivered,0))}</th></tr></tfoot></table>
   {selectedSlip.observations&&<p className="delivery-observations"><b>Observations :</b> {selectedSlip.observations}</p>}<div className="delivery-signatures"><section><h3>Établi par</h3><b className="delivery-person-name">{selectedSlip.creator_full_name??'—'}</b><span>Signature</span><div className="delivery-sign-line"/></section><section><h3>Visa de réception</h3><b>Nom et prénoms du réceptionnaire</b><div className="delivery-blank-line"/><b>Fonction</b><div className="delivery-blank-line"/><b>Date de réception</b><div className="delivery-blank-line"/><span>Signature</span><div className="delivery-sign-line"/></section><section><h3>Cachet de l’établissement</h3><div className="delivery-stamp-box"/></section></div>
  </section>}
 </div>;
}
