"use client";

import { useEffect, useRef, useState } from "react";
import { workflowApi } from "../lib/workflow-client";
import type { CompetitionWorkflow } from "../lib/workflow-types";
import { COMPETITION_STATUS_LABELS } from "../lib/workflow-types";
import type { BulkOverview, PreparationState } from "../lib/similarity-bulk-types";
import ElapsedTime from "./elapsed-time";

/** Operate: extend the existing workshop. Competition list at left, one action and evidence at right.
 * Quiet teal/white surfaces, plain-language states; no red suspicion card and no AI verdict controls.
 */
const STATE_LABELS: Record<PreparationState,string> = {
 missing:"Henüz hazırlanmadı",queued:"Hazırlık bekliyor",running:"Hazırlanıyor",ready:"Hazır",
 partial:"Anlamsal veri eksik",empty:"Karşılaştırılabilir metin yok",failed:"Yeniden deneme gerekiyor",
};
export default function SimilarityWorkspace({competitions}:{competitions:CompetitionWorkflow[]}) {
 const [selected,setSelected]=useState<string|null>(null);
 const [data,setData]=useState<BulkOverview|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const active=useRef(true);
 const generation=useRef(0);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{
   if(!selected) return;
   let current=true;
   const token=++generation.current;
   workflowApi.bulkSimilarity(selected).then(result=>{
     if(current && token===generation.current) {setData(result);setLoading(false);}
   }).catch(caught=>{
     if(current) {setError(caught instanceof Error?caught.message:"Raporlar yüklenemedi.");setLoading(false);}
   });
   return()=>{current=false;};
 },[selected]);
 function choose(id:string) {
   if(id===selected) { void refresh(); return; }
   generation.current++;setSelected(id);setData(null);setError("");setLoading(true);setBusy(false);
 }
 async function refresh() {
   if(!selected)return;
   const token=generation.current;setLoading(true);setError("");
   try{const next=await workflowApi.bulkSimilarity(selected);if(active.current && generation.current===token)setData(next);}
   catch(caught){if(active.current && generation.current===token)setError(caught instanceof Error?caught.message:"Durum yenilenemedi.");}
   finally{if(active.current && generation.current===token)setLoading(false);}
 }
 async function prepare(id:string) {
   if(!selected || busy || loading)return;
   const token=generation.current;setBusy(true);setError("");setMessage("Rapor verisi hazırlanıyor; hakem kararı değişmez.");
   try{
     let next=await workflowApi.bulkSimilarityAction(selected,"prepare",id);
     if(active.current && generation.current===token)setData(next);
     // Poll only this explicitly requested job. Preparation itself survives browser navigation.
     for(let poll=0;active.current && generation.current===token && poll<330;poll++) {
       await new Promise(resolve=>setTimeout(resolve,2000));
       next=await workflowApi.bulkSimilarity(selected);
       if(!active.current || generation.current!==token)return;
       setData(next);
       const state=next.reports.find(report=>report.id===id)?.state;
       if(state==="ready" || state==="empty")break;
       if(state==="failed" || state==="partial")throw new Error("Hazırlık tamamlanamadı. Raporun yanındaki yeniden deneme düğmesini kullanabilirsiniz.");
     }
   }catch(caught){if(active.current && generation.current===token)setError(caught instanceof Error?caught.message:"Hazırlık tamamlanamadı.");}
   finally{if(active.current && generation.current===token){setBusy(false);setMessage("");}}
 }
 async function compare() {
   if(!selected || busy || loading)return;
   const token=generation.current;setBusy(true);setError("");setMessage("Onaylı raporlar karşılaştırılıyor…");
   try{
     let next=await workflowApi.bulkSimilarityAction(selected,"start");
     while(active.current && generation.current===token) {
       setData(next);
       if(next.run?.status!=="running")break;
       next=await workflowApi.bulkSimilarityAction(selected,"continue");
       // Give rendering and any concurrent owner of the lease time to progress.
       await new Promise(resolve=>setTimeout(resolve,250));
     }
   }catch(caught){if(active.current && generation.current===token)setError(caught instanceof Error?caught.message:"Tarama durdu. Kaldığı yerden devam edebilirsiniz.");}
   finally{if(active.current && generation.current===token){setBusy(false);setMessage("");}}
 }
 const competition=competitions.find(item=>item.id===selected);
 return <section className="workspace eval-workshop similarity-workspace" aria-labelledby="similarity-heading">
   <div className="workspace-heading"><div>
     <span className="section-kicker">Onaylı raporlar</span>
     <h1 id="similarity-heading">Benzerlik Analizi</h1>
     <p>Aynı yarışma, yıl ve aşamadaki onaylanmış raporları birlikte karşılaştırın. Bu çalışma hakem kararlarını değiştirmez.</p>
   </div></div>
   <div className="eval-workshop-layout">
     <nav className="eval-competition-list" aria-label="Benzerlik yarışmaları">
       {competitions.length?competitions.map(item=><button type="button" key={item.id}
         aria-current={selected===item.id?"true":undefined} className={selected===item.id?"active":""}
         disabled={busy} onClick={()=>choose(item.id)}><strong>{item.competitionName}</strong><span>{COMPETITION_STATUS_LABELS[item.status]}</span></button>)
         :<p className="library-empty">Size atanmış yarışma bulunmuyor.</p>}
     </nav>
     <div className="eval-workshop-main">
       {!selected?<p className="library-empty">Başlamak için soldan bir yarışma seçin.</p>:<>
         <div className="similarity-toolbar"><h2>{competition?.competitionName}</h2>
           <button type="button" className="text-button" disabled={busy||loading} onClick={()=>void refresh()}>Durumu yenile</button></div>
         {error?<p className="similarity-message" role="alert">{error}</p>:null}
         {loading?<p role="status">Onaylı raporlar yükleniyor…</p>:null}
         {data?<>
           <div className="similarity-intro">
             <p><strong>{data.poolSize} onaylı rapor</strong> · {data.readyCount} karşılaştırmaya hazır
               {data.missingCount? ` · ${data.missingCount} hazırlık bekliyor`:""}
               {data.emptyCount? ` · ${data.emptyCount} raporda karşılaştırılabilir metin yok`:""}</p>
             <p>Ret verilen ve henüz kararı verilmemiş başvurular bu listeye alınmaz. Kayıtlı verilerin karşılaştırılması yeni bir AI çağrısı yapmaz.</p>
             <button type="button" className="primary-button" disabled={busy||loading||data.readyCount<2||data.missingCount>0}
               onClick={()=>void compare()}>{busy?"İşlem sürüyor…":data.run?.status==="running"?"Taramaya devam et":data.run?.status==="completed"?"Kayıtlı sonuçları göster":"Benzerlikleri analiz et"}</button>
             {data.readyCount<2?<p>Karşılaştırma için en az iki hazır rapor gerekir.</p>:null}
             {data.missingCount>0?<p>Önce aşağıdaki eksik raporları hazırlayın. Başka hakeme ait eksik raporu ilgili hakem hazırlamalıdır.</p>:null}
           </div>
           {busy?<div className="similarity-progress" role="status"><p>{message}</p><ElapsedTime />
             {data.run?.status==="running"?<><progress value={data.run.processed} max={Math.max(1,data.run.total)} aria-label="Karşılaştırma ilerlemesi"/>
               <span>{data.run.processed} / {data.run.total} rapor çifti incelendi</span></>:null}</div>:null}
           <details className="similarity-readiness" open={data.missingCount>0}>
             <summary>Rapor hazırlık durumu ({data.poolSize})</summary>
             <ul>{data.reports.map(report=><li key={report.id}><div><strong>{report.label}</strong>
               <span>{STATE_LABELS[report.state]}</span>{report.message?<small>{report.message}</small>:null}</div>
               {report.canPrepare && report.state!=="ready" && report.state!=="empty"?<button type="button" className="text-button" disabled={busy||loading}
                 onClick={()=>void prepare(report.id)}>{report.state==="running"?"Hazırlığı kontrol et":"Veriyi hazırla"}</button>:null}
             </li>)}</ul>
           </details>
           {data.run?.status==="stale"?<p className="similarity-message" role="status">Onaylı raporlar veya hazırlık verileri değişti. Önceki oranlar gizlendi; yeni bir tarama başlatın.</p>:null}
           {data.run && data.run.status!=="stale"?<section className="similarity-results" aria-labelledby="similarity-results-heading">
             <h2 id="similarity-results-heading">{data.run.status==="completed"?"Karşılaştırma sonuçları":"Tarama sürüyor"}</h2>
             <p>{data.run.processed} / {data.run.total} seçili çift incelendi.
               {data.run.screened?" Büyük havuzda önce anlam ve metin yakınlığıyla aday çiftler seçildi; seçilmeyen çiftler için oran üretilmedi.":" Küçük havuzdaki size açık tüm farklı takım çiftleri karşılaştırılır."}</p>
             <p>Oran, iki rapordaki karşılaştırılabilir metnin eşleşen paylarının ortalamasıdır; projenin özgünlük puanı veya intihal kararı değildir.
               Şablon ve ortak dil yine de oranı etkileyebilir. En yakın en fazla 50 çift gösterilir.</p>
             {!data.run.pairs.length?<p>Gösterilecek rapor çifti henüz yok.</p>:data.run.pairs.map(pair=><details className="similarity-pair" key={pair.key}>
               <summary><span><strong>{pair.leftLabel} ↔ {pair.rightLabel}</strong><small>Eşleşen bölümleri incele</small></span>
                 <span className="similarity-percent">%{pair.percent}<small>metin yakınlığı</small></span></summary>
               <p>{pair.directCount} bölümde aynı veya çok yakın ifadeler · {pair.semanticCount} bölümde benzer anlatım.</p>
               {pair.evidence.length?pair.evidence.map((item,index)=><div className="similarity-evidence" key={index}>
                 <div><strong>{pair.leftLabel} · s. {item.leftPage}</strong><small>{item.leftSection}</small><blockquote>{item.leftText}</blockquote></div>
                 <div><strong>{pair.rightLabel} · s. {item.rightPage}</strong><small>{item.rightSection}</small><blockquote>{item.rightText}</blockquote></div>
               </div>):<p>Güçlü bir metin eşleşmesi bulunmadı.</p>}
             </details>)}
           </section>:null}
         </>:null}
       </>}
     </div>
   </div>
 </section>;
}
