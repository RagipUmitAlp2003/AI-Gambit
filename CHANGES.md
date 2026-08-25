# Değişiklik Kaydı

## 2026-08-25 · Nihai rol modeli ve olay bazlı değerlendirme akışı

Eski tasarımdan kalan "belgeyi 01 → 02 → 03 → 04 sırasıyla devretme" mantığı kaldırıldı.
Yerine iki bağımsız akış geldi: **yarışma hazırlığı (01 → 02 ikinci doğrulama)** ve
**başvuru değerlendirmesi (04 → AI ön değerlendirmesi → 02 nihai karar)**. Rol 03 bu
akışı üstten izler, Rol 00 yalnızca sistemi yönetir.

---

### 1. Rol numaralandırması (03 ↔ 04 takası)

| Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- |
| `03 = Yarışmacı`, `04 = Değerlendirme Yöneticisi` | `03 = Değerlendirme Yöneticisi`, `04 = Yarışmacı` | `app/lib/admin-roles.ts` (ROLES katalogu, `PARTICIPANT_ROLE`, `ASSIGNABLE_ROLE_CODES`, `boundary` alanı), `app/lib/admin-db.ts` (`applyRoleMigration`), `migrations/0004_roles_v2.sql` | ✅ Migration çalıştı; hesaplar ve denetim izi `actor_role` alanı takas edildi, hiçbir satır silinmedi |
| `00 = Baş Yönetici` | `00 = Moderatör / Sistem Yöneticisi` | `app/lib/admin-roles.ts`, `app/components/access-login.tsx`, `app/api/admin/dev-session/route.ts` | ✅ Giriş ekranı ve panolarda yeni ad görünüyor |
| `02 = Hakem / Değerlendirici` | `02 = Hakem` | `app/lib/admin-roles.ts` | ✅ |
| Rol adları bileşenlerde ayrı ayrı sabitti | Tüm adlar merkezi katalogdan okunuyor | `app/components/management-app.tsx`, `operations-panel.tsx`, `manager-profile-history.tsx` | ✅ |

---

### 2. Yetkilendirme (merkezi izin matrisi)

| Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- |
| Her route içinde `requireRoles(request, ["00","02",…])` elle yazılıyordu | Tek kaynak `PERMISSIONS` matrisi + `requirePermission(request, izin)` | `app/lib/authorization.ts` (yeni), `app/lib/admin-guard.ts`, tüm `app/api/**/route.ts` | ✅ 25 API yetki testi geçti |
| Nihai hakem kararı `["00","02"]` idi | `save_review` yalnızca `02` | `app/api/applications/[id]/route.ts` (`final_judgement`) | ✅ 00/01/03/04 → 403 |
| Profil onayı yoktu; 01 doğrudan yayımlıyordu | `review_profile` = `["00","02"]` | `app/api/profiles/route.ts` PATCH | ✅ 01 ve 03 → 403 |
| Operasyon panosu `["00","04"]` | `operations_dashboard` = `["00","03"]` | `app/api/metrics/route.ts`, `app/api/operations/route.ts` (yeni) | ✅ 02 ve 04 → 403, 03 → 200 |
| Yarışmacı kriter profillerini görebiliyordu | `read_profiles` dışında | `app/lib/authorization.ts` | ✅ 04 → 403 |
| Sayfa geçitleri sabit rol listesiyle | `rolesFor("author_profile")` / `rolesFor("run_ai_prescreen")` | `app/kriter-atolyesi/page.tsx`, `app/degerlendirme/page.tsx` | ✅ |

---

### 3. Aşama A · Profil hakem doğrulaması (yeni)

| Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- |
| 01 "Profili onayla" deyince profil anında `published` ve aktif oluyordu | `draft → judge_review_pending → (changes_requested) → approved`; yalnızca `approved` profil değerlendirmede kullanılabilir | `app/lib/workflow-types.ts` (`ProfileStatus`), `app/lib/workflow-db.ts` (`submitProfileForReview`, `reviewProfile`, `findApprovedProfile`, `listProfiles`), `app/api/profiles/route.ts` | ✅ Onaysız profille `start_analysis` → 409 |
| Hakem kriterleri göremiyordu | Hakem kriter ekler / düzeltir / kaldırır, puanı düzeltir, onaylar veya gerekçeli düzeltme ister | `app/components/profile-review-panel.tsx` (yeni) | ✅ Kriter eklendi, onaylandı, düzeltme döngüsü çalıştı |
| — | Gerekçesiz düzeltme talebi reddediliyor | `app/api/profiles/route.ts` | ✅ 400 |
| 01 onay durumunu göremiyordu | "Profillerim" bölümünde durum rozeti + hakem notu | `app/components/manager-profile-history.tsx` | ✅ |
| `PublishedProfile` tipi (artık yanıltıcı) | `CompetitionProfile` | `workflow-types.ts`, `workflow-db.ts`, `workflow-client.ts`, ilgili bileşenler | ✅ tsc temiz |

---

### 4. Durum modeli ve olay bazlı zaman çizelgesi

| Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- |
| `submitted / analyzing / awaiting_judge / completed / analysis_failed` | `judge_in_review` eklendi (hakem açtı, bitirmedi) | `app/lib/workflow-types.ts`, `app/lib/workflow-db.ts` (`saveApplicationReview`) | ✅ Geçiş doğrulandı |
| Durum etiketleri üç ayrı dosyada tekrarlıydı | Tek `APPLICATION_STATUS_LABELS` | `workflow-types.ts` + `evaluation-app.tsx`, `operations-panel.tsx`, `participant-portal.tsx`, `judge-queue-panel.tsx` | ✅ |
| `document_flows` / `document_handoffs` sıralı devir tabloları (ölü kod) | `workflow_events` olay tablosu | `app/lib/admin-db.ts` (~200 satır ölü kod kaldırıldı), `app/lib/admin-types.ts`, `app/api/timeline/route.ts` (yeni) | ✅ Profil ve başvuru zaman çizelgesi çalışıyor |
| Hakemin AI puanını değiştirmesi kayda geçmiyordu | `judge_score_adjusted` olayı: "AI puanı: 40 → Hakem nihai puanı: 44 · Değişiklik gerekçesi: …" | `app/lib/workflow-db.ts` (`scoreAdjustmentEvents`) | ✅ Zaman çizelgesinde göründü |
| Denetim izinde `flow_*` etiketleri | Süreç işlemleri (`profile_approved`, `save_review`, …) | `app/components/audit-panel.tsx` | ✅ |

**Not:** Eski `document_flows` / `document_handoffs` tabloları tarihsel kayıt olarak
veri tabanında bırakıldı; uygulama artık okumaz.

---

### 5. Rol panoları

| Rol | Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- | --- |
| 00 | Hesap yönetimi + operasyon panosu | Yalnızca hesap/rol/denetim; operasyon panosu kaldırıldı | `management-app.tsx` | ✅ |
| 01 | Kriter Atölyesi + geçmiş | + "Profillerim · hakem onay durumu" | `management-app.tsx`, `manager-profile-history.tsx` | ✅ |
| 02 | Yalnızca Değerlendirme Atölyesi bağlantısı | + "Profil doğrulama" + "Hakem kuyruğu" | `profile-review-panel.tsx`, `judge-queue-panel.tsx` (yeni) | ✅ |
| 03 | 6 sayaç | 9 sayaç (AI analizinde / analiz tamamlandı / hakem değerlendirmesinde / hatalı analiz / tamamlanma %) + operasyonel uyarılar + son süreç hareketleri | `operations-panel.tsx`, `app/api/operations/route.ts` | ✅ |
| 04 | Portal | Aynı; terminoloji "AI ön değerlendirmesi" olarak düzeltildi, durum etiketi gösteriliyor | `participant-portal.tsx` | ✅ |

---

### 6. Veri sızıntısı daraltması

| Eski Durum | Yeni Durum | Değiştirilen Dosyalar | Test Sonucu |
| --- | --- | --- | --- |
| Operasyon rolü ekip üyelerini ve PDF adını görmüyordu ama AI çıktısı da tamamen kapalıydı | `redactEvaluation`: 01 ve 03 puan/kriter durumunu görür; kanıt alıntısı, gerekçe ve yarışmacı geri bildirimi kaldırılır | `app/lib/workflow-db.ts` | ✅ `rationale` boş, `fileName` null, `teamMembers` boş |
| 01 tüm başvuruları görüyordu | 01 yalnızca kendi profilini hazırladığı yarışmaların başvurularını görür | `app/lib/workflow-db.ts` (`applicationVisibility`) | ✅ |
| Yarışmacı hesabı moderatör panelinde yönetici rolüne çevrilebiliyor gibi görünüyordu | Yarışmacı satırında rol seçici yerine sabit etiket | `app/components/admin-accounts-panel.tsx` | ✅ |

---

### 7. Terminoloji

`AI = ön değerlendirme`, `Hakem = nihai uzman değerlendirmesi`. AI çıktısı hiçbir ekranda
"nihai karar" olarak sunulmuyor. Etkilenen dosyalar: `evaluation-app.tsx`,
`criteria-app.tsx`, `participant-portal.tsx`, `operations-panel.tsx`, `judge-queue-panel.tsx`,
`app/api/applications/[id]/route.ts` (409 mesajı).
