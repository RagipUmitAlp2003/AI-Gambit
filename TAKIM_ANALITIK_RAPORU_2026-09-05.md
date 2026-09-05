# Takım üyesi bilgileri ve yönetim analitiği — 5 Eylül 2026

**Dal:** `last_frontend` · **Commit / push / merge yapılmadı.** Değişiklikler çalışma ağacında duruyor.

frontend.md ile gelen üç ekran özelliği (yönetici panelinin üç kutucuğu, hakem yarışma arama
kutusu ve öncelikli kartlar, satır altında açılan kriter editörü) dokunulmadan korundu;
`admin-accounts-panel.tsx`, `competition-picker.tsx`, `criteria-app.tsx` ve `evaluation.css`
değişmedi. `tools/analytics-access.test.ts` bu üç özelliği kaynak üzerinden sabitler.

## Değiştirilen ve eklenen dosyalar

| Dosya | Ne değişti |
|---|---|
| `migrations/0017_team_member_analytics.sql` | **Yeni.** Üye satırına `is_applicant`, `gender`, `education_level`, `grade_level`, `institution`, `city`, `teknofest_history`; başvuru ayrıntısına `discovery_source`, `team_size`. |
| `app/lib/team-profile.ts` | **Yeni.** Seçenek listeleri (81 il, 22 lise + 26 üniversite önerisi, 14 duyuru kanalı), sınıf/eğitim eşlemesi, takım büyüklüğü, yineleme tespiti, alan odaklı doğrulama, sunucu allowlist ayrıştırma, eski istemci yolu. |
| `app/lib/participation-analytics.ts` | **Yeni.** Saf analitik katmanı: filtre allowlist'i, tek veri kümesi, kırılımlar, küçük örneklem koruması, deterministik yönetim notları, AI–hakem uyumu. |
| `app/api/operations/analytics/route.ts` | **Yeni.** `operations_dashboard` izniyle korunan GET ucu; yalnızca toplulaştırılmış sonuç döner; geçersiz filtre 400. |
| `app/components/team-members-editor.tsx` | **Yeni.** Başvuru sahibi + üye kartları; kart tıklanınca satırın altında açılır, tekrar tıklanınca kapanır (kriter editörüyle aynı dil). |
| `app/components/participation-analytics-panel.tsx` | **Yeni.** "Katılım ve karar analitiği" görünümü: 12 filtre, temel değerler, 8 kırılım, yönetim notları, AI–hakem uyumu ve zorunlu açıklama. |
| `app/components/participant-portal.tsx` | Eski ad listesi yerine ekip editörü; gönderme denemesinde alan odaklı hatalar. |
| `app/components/operations-panel.tsx` | Üstte iki çalışma görünümü kutucuğu: "Süreç ve iş yükü" (mevcut ekran aynen) · "Katılım ve karar analitiği". |
| `app/api/applications/route.ts` | `teamProfile` JSON'unu allowlist ile ayrıştırır; yalnızca `teamMembers` gelirse eski yol ("Belirtilmedi"). |
| `app/lib/workflow-db.ts` | Sütun yükseltmeleri, `createApplication` ekip profili yazımı, `toApplication` yeni alanlar, `listAnalyticsRecords` (ad/e-posta/dosya/gerekçe okumaz). |
| `app/lib/workflow-types.ts`, `app/lib/workflow-client.ts` | `teamSize`, `applicantProfile`, `discoverySource`, üye demografi alanları; `submitApplication` ve `operationsAnalytics` istemci çağrıları. |
| `app/globals.css` | `.team-entry*`, `.analytics-*`, `.operations-view-nav` ve mobil kuralları (mevcut kurallar değişmedi). |
| `tools/ts-resolve-hook.mjs` | Node 22.13–22.14 uyumu: `module.registerHooks` yoksa aynı çözümleme `module.register` ile yapılır (paket `engines` ≥22.13). |
| `tools/team-profile.test.ts`, `tools/participation-analytics.test.ts`, `tools/analytics-access.test.ts`, `tools/migrations.test.ts` | Yeni testler (aşağıda). |

## Veriler nasıl saklanıyor

- Bilgiler **hesap tablosuna bağlanmaz**; `application_team_members` satırlarına başvuru kimliğiyle yazılır.
  Başvuru sahibi de aynı tabloda `is_applicant = 1`, `member_order = 0` satırıdır; diğer üyeler 1..n.
- `discovery_source` ve `team_size` başvuru düzeyinde `application_submission_details` içindedir.
- Başvuru anındaki görüntü değişmezdir: sonraki başvuruda farklı kurum/sınıf verilmesi eski satırı etkilemez.
- Eski başvurularda sütunlar NULL kalır; okuma tarafı NULL'u `unspecified` ("Belirtilmedi") sayar,
  başvuru sahibi satırı yoksa örtük olarak "Belirtilmedi" alanlarıyla sayılır, `teamSize` = üye sayısı + 1.
- `teamMembers` alanı geriye uyum için yalnızca başvuru sahibi dışındaki üyeleri taşımaya devam eder;
  hakem ekranındaki "N ekip üyesi" satırı anlam değiştirmedi.
- Bu alanlar AI değerlendirmesine, kriter sonuçlarına, hakem kararına, benzerlik motoruna ve kabul/ret
  akışına girmez (`tools/analytics-access.test.ts` ilgili modüllerde alan adlarının geçmediğini doğrular).

## Analitik oranların pay ve paydaları

| Oran | Pay | Payda | Kural |
|---|---|---|---|
| Tamamlanmış kararlar içindeki onay oranı | Onaylanan başvuru | Kararı tamamlanan başvuru (onay + ret + düzeltme) | Bekleyenler paydaya girmez; düzeltme ayrı sütunda gösterilir. Taslak sonuç "bekliyor" sayılır. |
| Kişi bazlı kırılımlar (cinsiyet, eğitim, sınıf, kurum, şehir, TEKNOFEST geçmişi) | Katılımcı = kişi sayısı; başvuru = değeri taşıyan başvuru başına **bir** kez | Aynı başvurudaki aynı kurumdan üç kişi: 3 katılımcı, 1 başvuru | Sonuç sayıları başvuru başına bir kez. |
| Başvuru bazlı kırılımlar (takım büyüklüğü, duyuru kaynağı) | Başvuru | Başvuru | Üye sayısıyla çoğaltılmaz; katılımcı sütunu boş. |
| AI bulgusunu olduğu gibi kullanma | `approved` kriter kararı | Tamamlanmış incelemelerdeki kesinleşmiş kriter kararları | Yalnızca `status = completed` incelemeler. |
| Nihai kriter sonucu uyumu | `approved` + (reddedildi ama nihai sonuç AI ile aynı) | Aynı payda | İki metrik ayrı raporlanır. |

Yönetim notları mevcut toplu verilerden deterministik üretilir (LLM çağrısı yok) ve korelasyon dilinde
yazılır; yatırım getirisi veya edinme maliyeti hesaplanmaz.

## Gizlilik ve küçük örneklem koruması

- Uç, sunucuda `requirePermission(request, "operations_dashboard")` ile korunur (yalnızca 04).
- `listAnalyticsRecords` katılımcı adı, e-posta, dosya adı, PDF metni, hakem gerekçesi ve kanıt alıntısı
  **okumaz**; hakem kararlarından yalnızca AI sonucu / hakem sonucu / aşama alınır.
- Yanıt yalnızca toplulaştırılmış sayaçlardır; hakemler "Hakem 1..N" etiketiyle anonimdir.
- Filtre anahtar ve değerleri sunucuda allowlist ile doğrulanır; bilinmeyen anahtar veya değer 400 döner.
- Üçten az tamamlanmış kararı (veya kriter kararı) olan her grupta oran yerine **"Örneklem yetersiz"** yazılır
  (`MIN_DECIDED_FOR_RATE = 3`).

## Testler ve sonuçlar

Görevde istenen 12 testin karşılıkları:

| # | Test | Dosya |
|---|---|---|
| 1 | Eğitim durumuna uygun sınıf doğrulaması | `team-profile.test.ts` |
| 2 | Başvuru sahibi dâhil takım büyüklüğü | `team-profile.test.ts` |
| 3 | Yinelenen üyenin iki kez sayılmaması | `team-profile.test.ts` |
| 4 | Duyuru kaynağının kişi sayısıyla çoğaltılmaması | `team-profile.test.ts`, `participation-analytics.test.ts` |
| 5 | Eski başvuruların "Belirtilmedi" ile çalışması | `team-profile.test.ts`, `participation-analytics.test.ts`, `migrations.test.ts` |
| 6 | Bekleyen başvuruların başarı oranına katılmaması | `participation-analytics.test.ts` |
| 7 | Küçük örneklemde oran gösterilmemesi | `participation-analytics.test.ts` |
| 8 | Dinamik filtrenin bütün kırılımlarda aynı veri kümesi | `participation-analytics.test.ts` |
| 9 | AI bulgusu kullanımı ile nihai sonuç uyumunun ayrılması | `participation-analytics.test.ts` |
| 10 | Yetkisiz rolün analitik API'ye erişememesi | `analytics-access.test.ts` |
| 11 | Analitik API'nin isim/e-posta/PDF/gerekçe döndürmemesi | `analytics-access.test.ts`, `participation-analytics.test.ts` |
| 12 | frontend.md üç arayüz özelliğinin korunması | `analytics-access.test.ts` |

Çalıştırılan kontroller (hepsi temiz):

```
npx tsc --noEmit -p tsconfig.json     → hata yok
npm run lint                          → hata yok
npm test                              → repo-safety PASS · regressions PASS · unit 403/403
npm run build                         → Build complete
```

Not: Bu makinedeki Node 22.14'te birim test kancası `module.registerHooks` bulunmadığı için hiç
çalışmıyordu (başlangıçta 30 dosyanın tamamı yükleme hatası veriyordu). Kanca geriye uyumlu hâle
getirildi; test kuralları değişmedi.
