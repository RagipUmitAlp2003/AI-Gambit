"use client";

import { useEffect, useRef, useState } from "react";
import { workflowApi } from "../lib/workflow-client";
import type { CompetitionWorkflow } from "../lib/workflow-types";
import { COMPETITION_STATUS_LABELS } from "../lib/workflow-types";
import type { BulkOverview, BulkPair, PreparationState } from "../lib/similarity-bulk-types";
import ElapsedTime from "./elapsed-time";

/** Operate: extend the existing workshop. Competition list at left, bounded analysis and evidence at right.
 * Quiet teal/white surfaces; only the assigned judge's explicit, reasoned action can change a result.
 */
const STATE_LABELS: Record<PreparationState,string> = {
 missing:"Henüz hazırlanmadı",queued:"Hazırlık bekliyor",running:"Hazırlanıyor",ready:"Hazır",
 partial:"Anlamsal veri eksik",empty:"Karşılaştırılabilir metin yok",failed:"Yeniden deneme gerekiyor",
};
const CONFIDENCE_LABELS={low:"Düşük güven",medium:"Orta güven",high:"Yüksek güven"} as const;
const DIMENSION_LABELS={problem:"Problem tanımı",solution:"Çözüm yaklaşımı",architecture:"Sistem mimarisi",
 method:"Yöntem / algoritma",validation:"Doğrulama yaklaşımı"} as const;
const DIMENSION_VALUE_LABELS={not_evidenced:"Kanıt yok",low:"Sınırlı",medium:"Belirgin",high:"Güçlü"} as const;
type NegativeDraft={pair:BulkPair;applicationId:string;applicationLabel:string};
export default function SimilarityWorkspace({competitions}:{competitions:CompetitionWorkflow[]}) {
 const [selected,setSelected]=useState<string|null>(null);
 const [data,setData]=useState<BulkOverview|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [notice,setNotice]=useState("");
 const [negativeDraft,setNegativeDraft]=useState<NegativeDraft|null>(null);
 const [negativeReason,setNegativeReason]=useState("");
 const [negativeError,setNegativeError]=useState("");
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
   generation.current++;setSelected(id);setData(null);setError("");setNotice("");setLoading(true);setBusy(false);setNegativeDraft(null);
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
 async function explain() {
   if(!selected || busy || loading || data?.run?.status!=="completed")return;
   const token=generation.current;setBusy(true);setError("");setNotice("");setMessage("En güçlü rapor çiftleri özgün içerik açısından yorumlanıyor…");
   try{
     const next=await workflowApi.bulkSimilarityAction(selected,"explain");
     if(active.current && generation.current===token)setData(next);
   }catch(caught){if(active.current && generation.current===token)setError(caught instanceof Error?caught.message:"AI özgünlük yorumu tamamlanamadı.");}
   finally{if(active.current && generation.current===token){setBusy(false);setMessage("");}}
 }
 function openNegative(pair:BulkPair,applicationId:string,applicationLabel:string) {
   setNegativeDraft({pair,applicationId,applicationLabel});setNegativeReason("");setNegativeError("");setNotice("");
 }
 async function markNegative() {
   if(!selected || !negativeDraft || busy)return;
   const reason=negativeReason.trim();
   if(!reason){setNegativeError("Olumsuz karar için yarışmacıya gösterilecek kısa bir gerekçe yazın.");return;}
   const token=generation.current;setBusy(true);setError("");setNegativeError("");setMessage("Hakem kararı kaydediliyor…");
   try{
     const next=await workflowApi.bulkSimilarityNegative(selected,{applicationId:negativeDraft.applicationId,
       pairKey:negativeDraft.pair.key,reason});
     if(active.current && generation.current===token){setData(next);setNotice(next.notice??"Başvuru sonucu olumsuz olarak güncellendi.");setNegativeDraft(null);setNegativeReason("");}
   }catch(caught){if(active.current && generation.current===token)setNegativeError(caught instanceof Error?caught.message:"Karar kaydedilemedi.");}
   finally{if(active.current && generation.current===token){setBusy(false);setMessage("");}}
 }
 const competition=competitions.find(item=>item.id===selected);
 return <section className="workspace eval-workshop similarity-workspace" aria-labelledby="similarity-heading">
   <div className="workspace-heading"><div>
     <span className="section-kicker">Onaylı raporlar</span>
     <h1 id="similarity-heading">Benzerlik Analizi</h1>
     <p>Aynı yarışma, yıl ve aşamadaki onaylanmış raporları birlikte karşılaştırın; güçlü eşleşmeleri kanıtlarıyla inceleyin.</p>
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
         {notice?<p className="similarity-notice" role="status">{notice}</p>:null}
         {loading?<p role="status">Onaylı raporlar yükleniyor…</p>:null}
         {data?<>
           <div className="similarity-intro">
             <p><strong>{data.poolSize} onaylı rapor</strong> · {data.readyCount} karşılaştırmaya hazır
               {data.missingCount? ` · ${data.missingCount} hazırlık bekliyor`:""}
               {data.emptyCount? ` · ${data.emptyCount} raporda karşılaştırılabilir metin yok`:""}</p>
             <p>Ret verilen ve henüz kararı verilmemiş başvurular bu listeye alınmaz. Matematiksel karşılaştırma yeni bir üretken AI çağrısı yapmaz.</p>
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
              <h2 id="similarity-results-heading">Benzerlik inceleme akışı</h2>
              <section className="similarity-step-section" aria-labelledby="similarity-math-heading">
                <header className="similarity-step-heading"><span aria-hidden="true">1</span><div>
                  <h3 id="similarity-math-heading">Metin benzerliği taraması</h3>
                  <p>Rapor çiftleri matematiksel olarak karşılaştırıldı; bu aşamada üretken AI kullanılmadı.</p>
                </div><strong>{data.run.status==="completed"?"Tamamlandı":"Sürüyor"}</strong></header>
                <p>{data.run.processed} / {data.run.total} seçili çift incelendi.
                  {data.run.screened?" Büyük havuzda önce en yakın aday çiftler seçildi.":" Size açık farklı takım çiftleri karşılaştırıldı."}</p>
                <p className="similarity-caveat">Gösterilen oran bir özgünlük puanı veya intihal kararı değildir; ortak şablon ve alan dili oranı etkileyebilir.</p>
              </section>
              {data.run.status==="completed"?<section className="similarity-step-section" aria-labelledby="similarity-ai-heading">
                <header className="similarity-step-heading"><span aria-hidden="true">2</span><div>
                  <h3 id="similarity-ai-heading">Özgün içerik yorumu</h3>
                  <p>En güçlü en fazla 5 çift; problem, çözüm, mimari, yöntem ve doğrulama yaklaşımı bakımından tek AI çağrısıyla açıklanır.</p>
                </div><strong>{data.run.aiStatus==="completed"?"Tamamlandı":data.run.aiStatus==="skipped"?"Atlandı":"İsteğe bağlı"}</strong></header>
                <div className="similarity-ai-action">
                  <p>AI yalnızca kayıtlı eşleşme kanıtlarını yorumlar; matematiksel oranı ve alıntıları değiştiremez.</p>
                  {data.run.aiStatus==="not_started"||data.run.aiStatus==="failed"?<button type="button" className="secondary-button"
                    disabled={busy||loading} onClick={()=>void explain()}>{data.run.aiStatus==="failed"?"Yorumu yeniden oluştur":"Özgünlük yorumunu oluştur"}</button>:null}
                  {data.run.aiStatus!=="not_started"?<p className={`similarity-ai-status ${data.run.aiStatus}`}>{data.run.aiMessage}</p>:null}
                </div>
              </section>:null}
              <section className="similarity-step-section" aria-labelledby="similarity-pairs-heading">
                <header className="similarity-step-heading"><span aria-hidden="true">3</span><div>
                  <h3 id="similarity-pairs-heading">Eşleşmeleri inceleyin</h3>
                  <p>En yakın rapor çiftlerini açın; AI yorumunu ve dayandığı metinleri ayrı ayrı değerlendirin.</p>
                </div><strong>{data.run.pairs.length} çift</strong></header>
                {!data.run.pairs.length?<p>Gösterilecek rapor çifti henüz yok.</p>:data.run.pairs.map(pair=><details className="similarity-pair" key={pair.key}>
                  <summary><span><strong>{pair.leftLabel} ↔ {pair.rightLabel}</strong><small>{pair.directCount} yakın ifade · {pair.semanticCount} benzer anlatım</small></span>
                    <span className="similarity-percent">%{pair.percent}<small>metin yakınlığı</small></span></summary>
                  <div className="similarity-pair-body">
                    {pair.aiReview?<section className={`similarity-ai-review level-${pair.aiReview.level}`} aria-label="AI özgünlük yorumu">
                      <header><div><span>AI özgünlük yorumu</span><strong>{pair.aiReview.label}</strong></div>
                        <small>{CONFIDENCE_LABELS[pair.aiReview.confidence]}</small></header>
                      <p>{pair.aiReview.explanation}</p>
                      {pair.aiReview.focusAreas?.length?<div className="similarity-focus-areas"><span>Benzerliğin odağı</span>
                        <ul>{pair.aiReview.focusAreas.map(area=><li key={area}>{area}</li>)}</ul></div>:null}
                      {pair.aiReview.dimensions?<dl className="similarity-dimensions">
                        {Object.entries(pair.aiReview.dimensions).map(([key,value])=><div key={key}>
                          <dt>{DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS]}</dt>
                          <dd className={`dimension-${value}`}>{DIMENSION_VALUE_LABELS[value]}</dd>
                        </div>)}
                      </dl>:null}
                      <small>Bu dağılım yalnızca aşağıdaki eşleşme kanıtlarını açıklar; raporların görünmeyen bölümleri hakkında varsayım içermez.</small>
                    </section>:null}
                    <details className="similarity-evidence-disclosure" open={!pair.aiReview}>
                      <summary>Karşılaştırılan metinleri göster ({pair.evidence.length})</summary>
                      {pair.evidence.length?pair.evidence.map((item,index)=><div className="similarity-evidence" key={index}>
                        <div><strong>{pair.leftLabel} · s. {item.leftPage}</strong><small>{item.leftSection}</small><blockquote>{item.leftText}</blockquote></div>
                        <div><strong>{pair.rightLabel} · s. {item.rightPage}</strong><small>{item.rightSection}</small><blockquote>{item.rightText}</blockquote></div>
                      </div>):<p>Güçlü bir metin eşleşmesi bulunmadı.</p>}
                    </details>
                    {pair.canMarkLeftNegative||pair.canMarkRightNegative?<section className="similarity-decision-actions" aria-label="Hakem kararı">
                      <div><strong>Başvuru kararını gözden geçirin</strong><p>Benzerlik kanıtı tek başına ret değildir. Nihai değerlendirme size aittir.</p></div>
                      <div className="similarity-decision-targets">
                        {pair.canMarkLeftNegative?<div><span>{pair.leftLabel}</span><button type="button" className="secondary-button" disabled={busy}
                          onClick={()=>openNegative(pair,pair.leftId,pair.leftLabel)}>Kararı gözden geçir</button></div>:null}
                        {pair.canMarkRightNegative?<div><span>{pair.rightLabel}</span><button type="button" className="secondary-button" disabled={busy}
                          onClick={()=>openNegative(pair,pair.rightId,pair.rightLabel)}>Kararı gözden geçir</button></div>:null}
                      </div>
                    </section>:null}
                    {negativeDraft?.pair.key===pair.key?<div className="similarity-negative-form">
                      <div><strong>Başvuru sonucunu yeniden değerlendirin</strong>
                        <p><b>{negativeDraft.applicationLabel}</b> için daha önce verilen onay kararını olumsuz sonuçla değiştirmek üzeresiniz. Kriter kararları ve benzerlik kanıtı korunur.</p></div>
                      <label>Karar gerekçesi<textarea maxLength={1000} rows={4} value={negativeReason}
                        onChange={event=>{setNegativeReason(event.target.value);setNegativeError("");}}
                        placeholder="Benzerlik kanıtının neden başvuru sonucunu değiştirdiğini açıklayın."/></label>
                      {negativeError?<p className="field-error" role="alert">{negativeError}</p>:null}
                      <div className="similarity-form-actions"><button type="button" className="text-button" disabled={busy}
                        onClick={()=>{setNegativeDraft(null);setNegativeReason("");setNegativeError("");}}>Vazgeç</button>
                        <button type="button" className="primary-button danger" disabled={busy||!negativeReason.trim()} onClick={()=>void markNegative()}>Olumsuz sonuç olarak kaydet</button></div>
                    </div>:null}
                  </div>
                </details>)}
              </section>
            </section>:null}
         </>:null}
       </>}
     </div>
   </div>
 </section>;
}
