# SİMÜLASYON RAPORU — Çelikkubbe Uçtan Uca Doğrulama (26–27 Ağustos 2026)

Bu rapor, "TEKNOFEST Problem 4 Sisteminin Son Kontrolü, Düzeltilmesi ve Tam Uçtan Uca
Simülasyonu" görevinin nihai çıktısıdır. Simülasyon **canlı yerel sunucuda**
(`npm run dev`, localhost:3000), **gerçek Gemini çağrılarıyla** (kullanıcı izni alındı)
ve üç gerçek PDF ile koşulmuştur. Hiçbir commit/push yapılmadı; tüm değişiklikler
çalışma kopyasında incelemeye hazırdır.

---

## 1) Başlangıç kontrolünde tespit edilen sorunlar

| # | Sorun | Yer |
|---|-------|-----|
| 1 | Hakem Onayla/Ret düğmeleri **kriter sonucunu** ifade ediyordu; görev tanımı bunların **AI bulgusunun kabulünü/reddini** ifade etmesini istiyor (anlamsal ters çevirme) | `judge-review.ts`, `types.ts`, `workflow-db.ts`, `evaluation-app.tsx`, API |
| 2 | Ret durumunda hakemin **kendi sonucu (UYGUN/OLUMSUZ)** ve kaynak bölüm alanı yoktu | Karar modeli + UI + doğrulama |
| 3 | Operasyon panosu (04) giriş metni hâlâ "Başvurulara ilk hakemi atayın" diyordu; manuel atama kaldırılmıştı | `management-app.tsx` |

## 2) Simülasyon sırasında bulunan hatalar

| # | Hata | Nasıl bulundu |
|---|------|---------------|
| 1 | **Hakem atama yığılması**: Çelikkubbe'nin iki başvurusu da Hakem 1'e atandı; en az dosyalı hakem önceliği çalışmıyordu | Aşama 3, canlı sunucuda gerçek atama |
| 2 | Operasyon panosundaki bayat metin (yukarıdaki #3) | Gerçek tarayıcı (Chrome) ile UI doğrulaması |

## 3) Kök nedenler

1. **Atama yığılması**: `autoAssignJudge` sıralaması `ORDER BY (competition_files > 0) DESC, open_files ASC` idi — "aynı yarışmaya aşinalık" kriteri **yük dengesinin önüne** geçiyordu. Görev tanımı §5 açıkça "en az açık dosyası olan hakem" birincil kural der.
2. **Anlamsal ters çevirme**: önceki uygulamada `approved → kriter olumlu` varsayılmıştı; yeni tanımda `approved → AI bulgusu geçerli` (AI OLUMSUZ dediyse kesin sonuç OLUMSUZ olur), `rejected → hakemin kendi sonucu geçerli`.
3. **Bayat metin**: manuel atama kaldırılırken rol tanıtım sözlüğü güncellenmemişti.

## 4) Yapılan düzeltmeler

1. `workflow-db.ts` — atama sıralaması: `ORDER BY open_files ASC, (competition_files > 0) DESC, j.created_at ASC, j.id ASC` (önce yük, aşinalık yalnız eşitlik bozucu). Yanlış atanmış iki başvuru silindi, aşama 3 yeniden koşuldu: **10/10**.
2. Bulgu-doğrulama modeli yeniden kuruldu:
   - `JudgeCriterionDecision`e `judgeResult` (ret durumunda hakemin kendi UYGUN/OLUMSUZ sonucu) ve `evidenceSection` eklendi.
   - `effectiveVerdictOf`: `approved → aiVerdict`, `rejected → judgeResult`, `pending → null`.
   - Ret formunda zorunlu alanlar: kendi sonucu + gerekçe + kanıt (PDF konumu: sayfa/bölüm/alıntı **veya** "Raporda bulunamadı": aranan bölüm + eksik içerik).
   - Sayaçlar/nihai karar/katılımcı geri bildirimi yalnız **kesinleşmiş** sonuçlardan üretilir; bekleyen karar varken nihai karar kilitli.
   - Sunucu `decidedBy`/`decidedAt` damgalar, `aiVerdict`i saklı bulgulardan yeniden türetir (istemciden gelen değere güvenilmez); onayda hakem alanları temizlenir.
   - Denetim izinde yalnız reddedilen bulgular satır satır loglanır; özet "AI bulgusu: N onaylandı, M reddedildi" biçimindedir.
3. `management-app.tsx` 04 metni: "…Hakem ataması sistem tarafından otomatik yapılır."
4. Simülasyon betiğinde bulunan yardımcı hatalar (uygulama hatası değil): Türkçe İ büyük/küçük harf regex sorunu (`toLocaleLowerCase("tr-TR")` ile çözüldü), kullanılmayan değişken lint uyarıları.

## 5) Eklenen regresyon testleri

- `tools/authorization.test.ts` — atama SQL'inin `ORDER BY open_files ASC, (competition_files > 0) DESC` düzenini doğrulayan test (Çelikkubbe yığılma hatasına referanslı).
- `tools/judge-review.test.ts` — yeni anlamla tamamen yeniden yazıldı: AI-OLUMSUZ bulgu onaylanınca kesin sonuç OLUMSUZ; ret `judgeResult` olmadan geçersiz; sayaçlar uygun/olumsuz/bekleyen; geri bildirim kesin sonuçlardan.
- `tools/regression-tests.mjs` "Judge-decision flow" bloğu — `effectiveVerdictOf` kalıpları, ret formunda "kendi sonucu (UYGUN veya OLUMSUZ) zorunludur", benzerlik notunda diğer takımın PDF'ine bağlantı olmaması.
- `tools/e2e_scenario.mjs` 10c/10d — ret-`judgeResult`süz 409; AI-OLUMSUZ bulguyu `judgeResult: UYGUN` ile reddedince tüm kesin sonuçlar UYGUN → ONAY.

## 6) Korunan özellikler (dokunulmadı, çalıştıkları doğrulandı)

- D1 çalışma zamanı şema + eklemeli göçler (0001–0009), eski göçler değişmedi.
- PBKDF2 parola özetleri, oturum çerezi, rol/yetki matrisi (00–04), hız sınırlama.
- Kriter sürümleme (`criteria_profile_versions`), kalıcı **şartname analiz önbelleği** (temizlikte bilerek korundu — jeton tasarrufu), değerlendirme bellek önbelleği.
- MinHash parmak izi katmanı (`submission_fingerprints`, minhash-v1) aynen duruyor; üzerine melez katman eklendi.
- Yarışma yaşam döngüsü (aktif/pasif), katılımcı portalı, e-posta kutusu, denetim izi.
- Kullanıcının kendi İDA test verisi ("ai gambit" başvurusu) ve **tüm hesaplar** korundu.

## 7) Veritabanı / göç değişiklikleri

- Bu görevde **yeni göç yok**; şema değişikliği yok. Karar modeli `review_json` içinde saklandığı için `judgeResult`/`evidenceSection` alan ekleme gerektirmedi (eski kayıtlar `!= null` toleransıyla okunur).
- Önceki görevden gelen `migrations/0009_similarity_v2.sql` (similarity_chunks, similarity_results) geçerli ve canlı doğrulandı.

## 8) İki PDF arasındaki benzerlik — gerçek algoritma sonucu

- **KalkanVizyon (BENZERLIK_B) ↔ HisarNova (BENZERLIK_A): %100 · seviye `high` · yöntem `hybrid`** (MinHash doğrudan eşleşme: 3 blok + gemini-embedding-001/768 anlamsal kapsama). Dosyalar tasarım gereği neredeyse özdeş (100.081 vs 100.079 bayt).
- GokKalkan (TEST) ↔ havuz: **%95 · ŞÜPHELİ** rozeti hakem ekranında canlı görüldü.
- Not metni doğrulandı: "…otomatik ihlal, intihal veya ret kararı değildir; hakem tarafından incelenmelidir." Diğer takımın PDF'ine doğrudan bağlantı **yok**.
- Embedding önbelleği canlı doğrulandı: analiz silinip yeniden koşulduğunda **0 embedding API çağrısı** (önbellekten okundu).

## 9) Adım adım simülasyon sonuçları (canlı sunucu + gerçek Gemini)

| Aşama | İçerik | Sonuç |
|-------|--------|-------|
| 1 | Admin girişi, hesap/rol denetimleri, RBAC 403'leri | 17/17 |
| 2 | Şartname analizi (21 sn, 11 kriter, 3'ü PDF-dışı video kuralı) + yayım; yeniden koşuda önbellek isabeti (0 jeton) | 8/8 |
| 3 | Yarışmacı kayıtları, PDF yüklemeleri, **otomatik hakem ataması** (düzeltme sonrası farklı hakemlere) | 10/10 |
| 4 | HisarNova AI analizi (40,6 sn; 8 bulgu = 11−3 PDF-dışı; tümü kanıtlı) | 5/5 |
| 4b | Hakem kararları: bulgu onay/ret, kesin sonuçlar, ONAY | 8/8 |
| 5 | KalkanVizyon analizi + **%100 benzerlik** tespiti | 7/7 |
| 5b | Hakem: benzerlik değerlendirmesi + RET (deterministik gerekçe, sayfa+alıntı) | 7/7 |
| 6 | Katılımcı panelleri: sonuç, 2 bölümlü geri bildirim (yalnız Güçlü Yönler + Gelişime Açık Yönler), yüzde/karar gizleme kuralları | 13/13 |
| 7 | Analiz silme + yeniden açma + yeniden analiz (embedding önbellekten, 0 çağrı) | 12/12 |

Gerçek tarayıcı (Chrome) doğrulaması: giriş ekranı (rol seçimi yok), operasyon panosu
(hakem sütunu salt okunur "Sistem tarafından otomatik atandı", yalnız Hatırlat),
hakem ekranı (aşama şeridi, ŞÜPHELİ %95 rozeti, sorumluluk reddi, canlı sayaç
güncellemesi, Ret formu UYGUN/OLUMSUZ seçenekli, kilitli Nihai karar "7 bekleyen",
"AI analizini sil"), katılımcı paneli (REDDEDİLDİ + sayfa/alıntılı gerekçe + yalnız
iki geri bildirim bölümü). Tarayıcıda kayıt yapılmadı (Vazgeç ile çıkıldı), oturum kapatıldı.

## 10) Çalıştırılan tüm testler ve sonuçları

| Kontrol | Sonuç |
|---------|-------|
| `npx tsc --noEmit` | Temiz |
| `npm run lint` | 0 hata, 0 uyarı |
| `npm test` (repo güvenliği + 8 regresyon bloğu + 108 birim testi) | Tümü PASS, 108/108 |
| Uçtan uca senaryo (`tools/e2e_scenario.mjs`, temiz DB'de canlı sunucuya karşı) | **139/139 PASS** |
| `npm run build` | Başarılı |
| Simülasyon aşamaları (yukarıda) | 87/87 |
| Temizlik idempotency (`cleanup_sim_celikkubbe.mjs` ikinci koşu) | "Silinecek simülasyon verisi yok" |
| Geri yükleme sonrası duman testi (admin+hakem girişi, İDA başvurusu görünür) | Geçti |

E2E, temiz DB gerektirdiği için şu sırayla koşuldu: **sqlite anlık görüntüsü →
`dev_reset --apply` → e2e (139/139) → anlık görüntü geri yüklendi**. İDA veriniz ve
hesaplar bu sayede aynen korundu.

## 11) Temizlik

`tools/cleanup_sim_celikkubbe.mjs` (yeni, hedefli, idempotent): yalnız
"Çelikkubbe Hava Savunma Sistemleri Yarışması" kayıtlarını siler — 3 başvuru,
2 profil, 1 yarışma anahtarı, tüm çocuk tablolar (AI analizleri, hakem kararları,
benzerlik/embedding izleri, süreç olayları, denetim satırları, Çelikkubbe postaları).
Üretimde çalışmayı reddeder; varsayılan kuru çalıştırmadır. **Korunanlar**: tüm
hesaplar (test hesapları dahil), İDA verisi, şartname analiz önbelleği.
8 R2 nesnesi sahipsiz kaldı (betik dosya silmez; `.wrangler/state/v3/r2` altından
elle temizlenebilir — yerel geliştirme ortamı olduğu için zararsız).

## 12) Açık kalan konular

1. **Kriter sayısı düşük görünüyor**: Çelikkubbe şartnamesinden 11 kriter çıktı (İDA'da 26 idi). Şartname içeriğine bağlı olabilir; ancak model çıkarım kalitesi ayrı bir kalibrasyon koşusuyla ölçülmeli.
2. **ÖTR sayfa sınırı kriteri KTR raporuna uygulandı**: "Ön Tasarım Raporu Sayfa Sınırı" kriteri Kritik Tasarım Raporu'na da BAŞARILI verdi — kriter kalitesi/aşama eşlemesi iyileştirmesi düşünülebilir (davranış hatası değil, içerik kalitesi notu).
3. **Canlı embedding eşiği kalibrasyonu**: semantik eşikler (0.90/0.82) sınırlı örneklemle doğrulandı; üretim öncesi daha geniş bir korpusla kalibrasyon önerilir.
4. `app/lib/demo-report-evaluator.ts` ölü modül durumunda; ileride kaldırılabilir.

## 13) Üretim göçü ve yeniden yayın adımları

1. `wrangler d1 migrations apply <DB> --remote` — 0009 dahil eklemeli göçler (eski göçlere dokunulmadı; hepsi `IF NOT EXISTS` uyumlu).
2. `GEMINI_API_KEY` ve `MODERATOR_SECRET` gizlilerinin üretimde tanımlı olduğunu doğrulayın (anahtar hiçbir kaynak dosyada yer almaz).
3. `npm run build` + `wrangler deploy` (veya mevcut CI akışı).
4. Yayın sonrası duman testi: admin girişi → şartname analizi (önbellek isabeti beklenir) → bir test başvurusunda analiz + benzerlik.

## Değiştirilen dosyalar

**Değişen (30)**: GUIDE.md, NIHAI_SISTEM_AKISI.md, PROJE_DURUMU.md, README.md,
docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md, app/api/admin/accounts/route.ts,
app/api/admin/accounts/[id]/route.ts, app/api/applications/[id]/route.ts,
app/api/applications/[id]/similarity/route.ts, app/api/evaluate-report/route.ts,
app/api/operations/route.ts, app/api/participant/register/route.ts,
app/components/criteria-app.tsx, app/components/evaluation-app.tsx,
app/components/management-app.tsx, app/components/operations-panel.tsx,
app/components/participant-portal.tsx, app/evaluation.css, app/lib/admin-roles.ts,
app/lib/admin-types.ts, app/lib/authorization.ts, app/lib/mailer.ts,
app/lib/types.ts, app/lib/workflow-client.ts, app/lib/workflow-db.ts,
tools/authorization.test.ts, tools/dev_reset.mjs, tools/e2e_scenario.mjs,
tools/migrations.test.ts, tools/regression-tests.mjs

**Yeni (10)**: TESLIM_RAPORU_NIHAI_HAKEM_AKISI.md, app/lib/judge-review.ts,
app/lib/similarity-embedding.ts, app/lib/similarity-text.ts,
migrations/0009_similarity_v2.sql, tools/cleanup_sim_celikkubbe.mjs,
tools/judge-review.test.ts, tools/seed_demo_users.mjs, tools/sim_celikkubbe.mjs,
tools/similarity.test.ts

Commit/push yapılmadı — inceleme size bırakıldı.
