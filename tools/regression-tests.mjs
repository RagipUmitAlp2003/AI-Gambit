// İstek koruması (hız ve eşzamanlılık sınırı) regresyon testleri.
// Çalıştırma: npm run test:regressions
import { acquireAnalysisPermit } from "../app/lib/request-guard.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = "60000";
process.env.ANALYSIS_RATE_LIMIT_MAX = "10";
process.env.ANALYSIS_MAX_CONCURRENT = "1";
const first = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-a" } }));
assert(first.ok, "İlk analiz izni verilmelidir.");
const concurrent = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-b" } }));
assert(!concurrent.ok && concurrent.reason === "concurrency", "Eşzamanlı analiz sınırı çalışmalıdır.");
if (first.ok) first.release();

process.env.ANALYSIS_RATE_LIMIT_MAX = "1";
const rateFirst = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-c" } }));
assert(rateFirst.ok, "Yeni istemcinin ilk isteği kabul edilmelidir.");
if (rateFirst.ok) rateFirst.release();
const rateSecond = acquireAnalysisPermit(new Request("http://localhost/api", { headers: { "x-real-ip": "test-c" } }));
assert(!rateSecond.ok && rateSecond.reason === "rate", "İstek hız sınırı çalışmalıdır.");

console.log("Regression tests: PASS");

/*
 * `criteria.id` genel bir birincil anahtardır; analiz çıktısı ise her belgede aynı
 * "criterion-1..N" kimliklerini üretir. Satır anahtarı profille VE sırayla
 * nitelenmezse ikinci profil yayımı UNIQUE ihlaliyle 500 döner.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");
  assert(
    /return `\$\{profileId\}:\$\{position\}:\$\{criterionId \|\| "kriter"\}`/.test(source),
    "criteria satır kimliği profil ve sıra ile nitelenmelidir.",
  );
  const rowKey = (profileId, position, criterionId) => `${profileId}:${position}:${criterionId || "kriter"}`;
  const ids = Array.from({ length: 74 }, (_, index) => `criterion-${index + 1}`);
  const keys = [
    ...ids.map((id, index) => rowKey("profil-A", index, id)),
    ...ids.map((id, index) => rowKey("profil-B", index, id)),
    // Aynı profilde yanlışlıkla tekrarlanan kriter kimliği de çakışmamalı.
    rowKey("profil-C", 0, "manual-1"), rowKey("profil-C", 1, "manual-1"),
  ];
  assert(new Set(keys).size === keys.length, "Farklı profillerin kriter satırları çakışmamalıdır.");
}

/*
 * Yarışma seçimi: yayımlanmış profilin adı şartnameden çıkarılır ve koddaki sabit
 * COMPETITIONS havuzunda bulunmayabilir. Arama bu yüzden verilen liste üzerinde de
 * çalışabilmelidir; aksi hâlde "yayımlandı ama seçilemiyor" durumu doğar.
 */
{
  const { searchCompetitionList, searchCompetitions } = await import("../app/lib/competitions.ts");
  const open = [
    { name: "TEKNOFEST Havacılık, Uzay ve Teknoloji Festivali", field: "Genel" },
    { name: "İnsansız Deniz Aracı Yarışması", field: "Deniz" },
  ];
  assert(
    !searchCompetitions("TEKNOFEST Havacılık").items.some((item) => item.name === open[0].name),
    "Kurulum varsayımı: bu ad kayıtlı havuzda yok.",
  );
  assert(
    searchCompetitionList(open, "teknofest").items.some((item) => item.name === open[0].name),
    "Kayıtlı havuzda olmayan, başvuruya açık yarışma aramada bulunmalıdır.",
  );
  assert(searchCompetitionList(open, "").items.length === 2, "Boş aramada açık yarışmaların tamamı listelenmelidir.");
  assert(searchCompetitionList(open, "deniz").items.length === 1, "Arama açık yarışma listesi içinde daraltmalıdır.");
  // Türkçe karakter katlaması: "İnsansız" araması "insansiz" ile de bulunmalı.
  assert(
    searchCompetitionList(open, "insansiz").items.some((item) => item.name === open[1].name),
    "Türkçe karakter kullanılmadan da arama yapılabilmelidir.",
  );
  assert(searchCompetitionList([], "").items.length === 0, "Açık yarışma yoksa liste boş olmalıdır.");
}

/*
 * Gemini hata taksonomisi: "İşlem tamamlanamadı" gibi içi boş bir cümle
 * üretilmemeli; her yukarı akış hatası nedenini söylemeli ve geçici model
 * yokluğu "yeniden denenebilir" olarak işaretlenmeli.
 */
{
  const { describeGeminiFailure } = await import("../app/lib/gemini-generation.ts");
  const overloaded = describeGeminiFailure(503, "The model is overloaded.", "AI rapor analizi");
  assert(overloaded.httpStatus === 503, "Model yoğunluğu 503 ile bildirilmelidir.");
  assert(overloaded.transient, "Model yoğunluğu geçici sayılmalıdır.");
  assert(/yoğun/.test(overloaded.message), "Model yoğunluğu mesajı nedenini söylemelidir.");
  assert(/Yeniden dene/.test(overloaded.message), "Geçici hatada kullanıcıya yeniden deneme yolu gösterilmelidir.");

  const billing = describeGeminiFailure(429, "Your prepayment credits are depleted.", "AI rapor analizi");
  assert(/kredisi tükenmiş/.test(billing.message), "Tükenmiş bakiye, hız sınırından ayrı bildirilmelidir.");

  const auth = describeGeminiFailure(401, "API key not valid", "AI rapor analizi");
  assert(auth.httpStatus === 502, "Yukarı akış 401'i oturumu düşürmemek için 502 ile iletilmelidir.");
  assert(!auth.transient, "Kimlik doğrulama hatası geçici değildir.");

  const timeout = describeGeminiFailure(504, "zaman aşımı", "AI belge analizi");
  assert(timeout.transient && timeout.httpStatus === 503, "Zaman aşımı geçici sayılmalıdır.");

  const unknown = describeGeminiFailure(502, "quota metric 'x' exhausted", "AI rapor analizi");
  assert(unknown.message.includes("quota metric"), "Sınıflandırılamayan hatada sunucunun bildirdiği neden yazılmalıdır.");
  assert(
    !/^AI rapor analizi tamamlanamadı\.$/.test(unknown.message),
    "İçi boş 'tamamlanamadı' cümlesi üretilmemelidir.",
  );
}

/*
 * TEK ÇAĞRI: `runSingleGeneration` bir işlem için tam olarak bir generateContent
 * isteği gönderir ve gerçek çağrı sayısını bildirir. Yedek model, tarama turu ve
 * gizli yeniden deneme yoktur.
 */
{
  const { runSingleGeneration } = await import("../app/lib/gemini-generation.ts");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "The model is overloaded." } }), {
        status: 503, headers: { "content-type": "application/json" },
      });
    };
    const outcome = await runSingleGeneration({
      apiKey: "test", body: "{}", model: "test-model", timeoutMs: 5_000, label: "regression",
    });
    assert(calls === 1, `503 sonrası yeniden deneme yapılmamalıdır (yapılan istek: ${calls}).`);
    assert(!outcome.ok && outcome.status === 503, "503 olduğu gibi bildirilmelidir.");
    assert(outcome.apiCalls === 1, "Gerçek çağrı sayısı bildirilmelidir.");

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ candidates: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const success = await runSingleGeneration({
      apiKey: "test", body: "{}", model: "test-model", timeoutMs: 5_000, label: "regression",
    });
    assert(calls === 1, "Başarılı durumda da tek istek gönderilmelidir.");
    assert(success.ok && success.apiCalls === 1, "Başarılı çağrı 1 olarak sayılmalıdır.");

    const noModel = await runSingleGeneration({
      apiKey: "test", body: "{}", model: "", timeoutMs: 5_000, label: "regression",
    });
    assert(!noModel.ok && noModel.apiCalls === 0, "Hiç çağrı yapılmadıysa sayaç 0 olmalıdır.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/*
 * Rol sınırları: Admin (00) yalnızca 01/02/04 hesabı açar, Değerlendirme
 * Yöneticisi (04) nihai karar veremez, Hakem (02) yalnızca kendi dosyasını görür.
 */
{
  const { ASSIGNABLE_ROLE_CODES } = await import("../app/lib/admin-roles.ts");
  const { can, canUpdateProfile, canViewApplication } = await import("../app/lib/authorization.ts");
  assert(
    ["01", "02", "04"].every((code) => ASSIGNABLE_ROLE_CODES.includes(code)) && ASSIGNABLE_ROLE_CODES.length === 3,
    "Admin yalnızca 01, 02 ve 04 rollerini atayabilmelidir.",
  );
  assert(!can({ roleCode: "04" }, "final_judgement"), "Değerlendirme Yöneticisi nihai karar veremez.");
  assert(!can({ roleCode: "00" }, "read_applications"), "Admin başvuru akışına erişemez.");
  assert(
    !canViewApplication({ id: "hakem-1", roleCode: "02" }, { participantId: "y1", assignedJudgeId: null }),
    "Hakem atanmamış başvuruyu görmemelidir.",
  );
  assert(
    !canUpdateProfile("yonetici-b", "yonetici-a"),
    "Yarışma yöneticisi başka yöneticinin profilini güncelleyememelidir.",
  );
}

console.log("Extended regression tests: PASS");

/*
 * Kaynak sayfa doğrulaması: ayrıştırıcı sayfası olmayan veya belge sınırı
 * dışında kalan kriteri KAYDETMEZ. Sınır, sunucunun belgeden okuduğu sayfa
 * sayısıdır; istemciden gelen hatalı bir değer bütün sayfaları silemez.
 */
{
  const { normalizeCriteria } = await import("../app/lib/criteria-extraction.ts");
  const { countPdfPages, sourcePageLimit } = await import("../app/lib/pdf-page-count.ts");

  const criterion = (patch) => ({
    name: "Kural", stage: "criteria_evidence", required: true,
    description: "Açıklama.", violationOutcome: "Belgede belirtilmemiş",
    sourcePage: 3, sourceText: "Belgeden alıntı.", ...patch,
  });

  const strict = normalizeCriteria([
    criterion({ name: "Sayfasız", sourcePage: null }),
    criterion({ name: "Sıfır", sourcePage: 0, sourceText: "Başka alıntı." }),
    criterion({ name: "Aralık dışı", sourcePage: 99, sourceText: "Üçüncü alıntı." }),
    criterion({ name: "Geçerli", sourcePage: 3, sourceText: "Dördüncü alıntı." }),
  ], 10);
  assert(strict.criteria.length === 1, "Yalnızca sayfası doğrulanan kriter kaydedilmelidir.");
  assert(strict.criteria[0].sourcePage === 3, "Geçerli sayfa korunmalıdır.");
  assert(
    strict.criteria.every((item) => typeof item.sourcePage === "number"),
    "Kaydedilen hiçbir kriterin kaynak sayfası boş olamaz.",
  );
  assert(/kaynak sayfası doğrulanamadığı için kaydedilmedi/.test(strict.warnings[0]), "Düşen kriterler bildirilmelidir.");
  assert(strict.warnings[0].includes("Aralık dışı"), "Düşen kriterin adı uyarıda yer almalıdır.");

  // Sayfa sayısı: iki bağımsız ölçümden büyüğü alınır; istemci 0 gönderse bile
  // sunucu belgeden okur. Eski davranışta sınır 1'e düşüyor ve TÜM kaynak
  // sayfaları siliniyordu.
  const pdf = new TextEncoder().encode(
    "%PDF-1.7\n/Type /Pages /Count 12\n/Type /Page\n/Type /Page\n/Type /Page\ntrailer\n%%EOF",
  ).buffer;
  assert(countPdfPages(pdf, 1).pages > 1, "Sunucu sayfa sayısını belgeden okumalıdır.");
  assert(sourcePageLimit(pdf, 0).limit >= 12, "İstemci değeri eksikken sunucu ölçümü kullanılmalıdır.");
  assert(sourcePageLimit(pdf, 40).limit === 40, "İki ölçümden büyüğü alınmalıdır.");
  assert(sourcePageLimit(new TextEncoder().encode("bos").buffer, 0).limit === 1, "Ölçülemeyen belgede sınır en az 1 olmalıdır.");
}

console.log("Source page regression tests: PASS");

/*
 * PDF görüntü çözünürlüğü: Gemini, çok sayfalı şartnameleri MEDIUM çözünürlükte
 * 503 "high demand" ile reddediyor. Ölçüm (29 sayfa · 1,8 MB, aynı istek gövdesi):
 * MEDIUM 4/4 kez 503 · LOW 3/3 kez başarılı, aynı 14 kriter ve 14/14 kaynak sayfa.
 * Varsayılan bu yüzden LOW'dur ve iki uç da aynı ayarı kullanmalıdır.
 */
{
  const { readFileSync } = await import("node:fs");
  const { MEDIA_RESOLUTION, mediaResolutionPart, describeGeminiFailure } =
    await import("../app/lib/gemini-generation.ts");

  assert(MEDIA_RESOLUTION === "MEDIA_RESOLUTION_LOW", "Varsayılan görüntü çözünürlüğü LOW olmalıdır.");
  assert(
    mediaResolutionPart().mediaResolution.level === MEDIA_RESOLUTION,
    "Belge parçası yapılandırılan çözünürlüğü kullanmalıdır.",
  );

  for (const file of ["app/api/analyze/route.ts", "app/api/evaluate-report/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert(
      !/MEDIA_RESOLUTION_MEDIUM/.test(source),
      `${file} çözünürlüğü sabit MEDIUM'a bağlamamalıdır.`,
    );
    assert(/mediaResolutionPart\(\)/.test(source), `${file} ortak çözünürlük ayarını kullanmalıdır.`);
    // Ayar çıktıyı değiştirir; önbellek anahtarı ayarı içermezse yeni ayar hiç denenmez.
    assert(/MEDIA_RESOLUTION/.test(source.slice(source.indexOf("cacheContext") - 400, source.indexOf("cacheContext") + 400)),
      `${file} önbellek anahtarına çözünürlüğü eklemelidir.`);
  }

  // 503 mesajı, aynı belgede tekrarlanan hatanın kapasite değil AYAR sorunu
  // olabileceğini söylemeli; aksi hâlde kullanıcı boşuna "yeniden dene" der.
  const overloaded = describeGeminiFailure(503, "This model is currently experiencing high demand.", "AI belge analizi");
  assert(overloaded.transient && overloaded.httpStatus === 503, "503 geçici sayılmalıdır.");
  assert(/AYNI belge/.test(overloaded.message), "Tekrarlanan 503 için ayrı bir yönlendirme verilmelidir.");
}

console.log("Media resolution regression tests: PASS");

/*
 * Dil adı normalizasyonu: model dili İngilizce adlandırabiliyor ("Turkish"),
 * profildeki beklenen dil ise Türkçe ("Türkçe"). Ham metin karşılaştırılınca
 * DOĞRU dilde yazılmış rapor "dil uyuşmuyor" diye kırmızı işaretleniyordu.
 */
{
  const { expectedLanguageCode, languageLabel, languageMismatch } =
    await import("../app/lib/report-prechecks.ts");

  for (const [input, code] of [["Turkish", "tr"], ["Türkçe", "tr"], ["türkçe", "tr"], ["TURKISH", "tr"],
    ["English", "en"], ["İngilizce", "en"], ["ingilizce", "en"]]) {
    assert(expectedLanguageCode(input) === code, `"${input}" → ${code} olarak çözülmelidir.`);
  }
  assert(expectedLanguageCode("Klingonca") === null, "Tanınmayan dil null dönmelidir.");
  assert(languageLabel(expectedLanguageCode("Turkish")) === "Türkçe", "Model dili sistem etiketine çevrilmelidir.");
  assert(!languageMismatch("tr", "Turkish"), "Türkçe rapor + 'Turkish' beklentisi uyuşmazlık DEĞİLDİR.");
  assert(!languageMismatch("tr", "Türkçe"), "Türkçe rapor + 'Türkçe' beklentisi uyuşmazlık değildir.");
  assert(languageMismatch("en", "Türkçe"), "İngilizce rapor + Türkçe beklentisi uyuşmazlıktır.");
  assert(!languageMismatch("unknown", "Türkçe"), "Dil tespit edilemediyse uyuşmazlık üretilmez.");

  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/evaluate-report/route.ts", "utf8");
  assert(
    /expectedLanguageCode\(modelLanguage\)/.test(route),
    "Modelin dil adı sistem etiketine çevrilmelidir.",
  );
  const app = readFileSync("app/components/evaluation-app.tsx", "utf8");
  assert(
    /expectedLanguageCode\(stage\.detectedLanguage\)/.test(app),
    "Ekranda da ham metin değil dil KODU karşılaştırılmalıdır.",
  );
}

/*
 * Aynı adla birden çok yarışma satırı: model yıl/aşamayı biraz farklı çıkarınca
 * `competitionKey` değişiyor ve AYNI ADLA profilsiz ikinci bir satır açılıyordu.
 * "En son güncellenen" sorgusu bu boş satırı seçip yayımlanmış olanı gölgeliyor,
 * yarışmacı listede gördüğü yarışmaya başvuramıyordu.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");

  const finder = source.slice(source.indexOf("export async function findCompetitionWorkflow"));
  const finderBody = finder.slice(0, finder.indexOf("\n/**"));
  assert(
    /\(current_profile_id IS NOT NULL\) DESC/.test(finderBody),
    "Profili olan satır öncelikli seçilmelidir.",
  );
  // Aktif/pasif anahtarı eklendikten sonra "başvuruya açık" ölçütü hem süreç
  // durumunu hem AKTİFLİĞİ kapsar; arşivlenmiş satır en sona düşer.
  assert(
    /\(status = 'open' AND is_active = 1\) DESC/.test(finderBody),
    "Başvuruya açık ve aktif satır öncelikli seçilmelidir.",
  );
  assert(/\(deleted_at IS NULL\) DESC/.test(finderBody), "Arşivlenmiş satır öncelikli seçilmemelidir.");

  const accepts = source.slice(source.indexOf("export async function competitionAcceptsApplications"));
  const acceptsBody = accepts.slice(0, accepts.indexOf("\n/**"));
  assert(
    /status = 'open' AND current_profile_id IS NOT NULL/.test(acceptsBody),
    "Başvuru kabulü, adla eşleşen HERHANGİ bir açık ve profilli satıra bakmalıdır.",
  );
  // PASİF yarışma yeni başvuru KABUL ETMEZ (madde 6).
  assert(
    /is_active = 1 AND deleted_at IS NULL/.test(acceptsBody),
    "Pasif veya arşivlenmiş yarışma yeni başvuru kabul etmemelidir.",
  );

  // Yarışmacının seçim listesi de aynı ölçütü kullanır; ikisi ayrışırsa
  // yarışmacı listede görüp başvuramaz.
  const openList = source.slice(source.indexOf("export async function listOpenCompetitions"));
  const openBody = openList.slice(0, openList.indexOf("\nexport "));
  assert(
    /c\.is_active = 1 AND c\.deleted_at IS NULL/.test(openBody),
    "Pasif yarışma yarışmacının listesinde görünmemelidir.",
  );

  // Kök neden: analiz her koşuda yeni yarışma satırı açmamalı.
  const saveRun = source.slice(source.indexOf("export async function saveCriteriaExtractionRun"));
  const saveBody = saveRun.slice(0, saveRun.indexOf("\nexport "));
  assert(
    /if \(!published\) \{/.test(saveBody),
    "Yayımlanmış profili olan yarışma için analiz yeni satır açmamalıdır.",
  );
}

console.log("Language and competition lookup regression tests: PASS");

/*
 * DEĞERLENDİRME BÜTÜNLÜĞÜ (madde 3)
 *
 * İstemci modele profil ya da PDF gönderemez; sunucu zinciri kendisi kurar ve
 * sonucu kaydetmeden önce kriter sürümünü ve PDF özetini doğrular.
 */
{
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/evaluate-report/route.ts", "utf8");

  assert(/formData\.get\("applicationId"\)/.test(route), "Analiz isteği başvuru kimliğine bağlanmalıdır.");
  assert(/resolveEvaluationContext\(applicationId, auth\.account\)/.test(route), "Bağlam sunucuda çözülmelidir.");
  assert(/reportBucket\(\)\.get\(context\.fileKey\)/.test(route), "Rapor PDF'i R2'den okunmalıdır.");
  assert(
    !/formData\.get\("profile"\)/.test(route),
    "İstemciden profil ALINMAMALIDIR; kriterler sunucudaki son sürümden gelir.",
  );
  assert(
    !/const file = formData\.get\("file"\)/.test(route),
    "İstemciden PDF ALINMAMALIDIR; belge R2'deki geçerli sürümdür.",
  );
  // Önbellek anahtarı kriter sürümünü ve özetini içermeli: kriterler değişince
  // eski hakem analizi yeniden kullanılamaz.
  const cacheBlock = route.slice(route.indexOf("const cacheContext"), route.indexOf("const cacheKey"));
  assert(/context\.criteriaVersion\.criteriaHash/.test(cacheBlock), "Önbellek anahtarı kriter özetini içermelidir.");
  assert(/criteriaVersion\.criteriaVersion/.test(cacheBlock), "Önbellek anahtarı kriter sürümünü içermelidir.");
  assert(/reportHash/.test(cacheBlock), "Önbellek anahtarı katılımcı PDF özetini içermelidir.");
  assert(/PROMPT_VERSION/.test(cacheBlock), "Önbellek anahtarı istem sürümünü içermelidir.");
  assert(/PRIMARY_MODEL/.test(cacheBlock), "Önbellek anahtarı modeli içermelidir.");

  const applicationRoute = readFileSync("app/api/applications/[id]/route.ts", "utf8");
  // Dal gövdesi: yetki ternary'sindeki ilk eşleşme değil, GERÇEK dal aranır.
  const saveStart = applicationRoute.indexOf('} else if (body.action === "save_evaluation")');
  const saveBlock = applicationRoute.slice(
    saveStart,
    applicationRoute.indexOf('} else if (body.action === "archive_application")', saveStart),
  );
  assert(saveStart > 0 && saveBlock.length > 0, "save_evaluation dalı bulunmalı.");
  assert(/resolveEvaluationContext\(id, auth\.account\)/.test(saveBlock), "Kayıt öncesi bağlam yeniden çözülmelidir.");
  assert(/criteriaHash !== context\.criteriaVersion\.criteriaHash/.test(saveBlock), "Kriter özeti eşleşmelidir.");
  assert(/pdfHash !== expectedHash/.test(saveBlock), "PDF özeti eşleşmelidir.");
  assert(/Kriterler güncellendi, yeniden analiz gerekli/.test(saveBlock), "Uyumsuzlukta açık hata dönmelidir.");
}

/*
 * KRİTER SÜRÜMLERİ DEĞİŞMEZDİR (madde 2)
 *
 * Yayımlama var olan sürümü GÜNCELLEMEZ; yeni satır açar. Geçmiş
 * değerlendirmeler kendi sürümüyle korunur.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");
  const publish = source.slice(source.indexOf("async function publishCriteriaVersion"));
  const body = publish.slice(0, publish.indexOf("\nexport "));
  assert(/INSERT INTO criteria_profile_versions/.test(body), "Yeni sürüm INSERT ile açılmalıdır.");
  assert(
    !/UPDATE criteria_profile_versions/.test(source),
    "Var olan kriter sürümü hiçbir yerde GÜNCELLENMEMELİDİR.",
  );
  assert(
    !/DELETE FROM criteria_profile_versions/.test(source),
    "Kriter sürümü silinmemelidir; geçmiş denetlenebilir kalmalıdır.",
  );
  assert(/criteria_version DESC LIMIT 1/.test(source), "Analiz SON sürümü kullanmalıdır.");

  // Nihai karar, eskimiş analiz üzerine verilemez.
  const review = source.slice(source.indexOf("export async function saveApplicationReview"));
  const reviewBody = review.slice(0, review.indexOf("\nexport "));
  assert(
    /Kriterler güncellendi, yeniden analiz gerekli/.test(reviewBody),
    "Kriterler değiştiyse nihai karar reddedilmelidir.",
  );
}

/*
 * KAYNAK SAYFA / ALINTI KİLİDİ (madde 12)
 *
 * Alanlar arayüzde salt okunurdur; sunucu istek elle düzenlense bile ilk
 * yayımdaki değeri geri koyar.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");
  const lock = source.slice(source.indexOf("export function applySourceLock"));
  const body = lock.slice(0, lock.indexOf("\n/**"));
  assert(/sourcePage: locked\.sourcePage/.test(body), "Kaynak sayfa ilk değerine geri konmalıdır.");
  assert(/sourceText: locked\.sourceText/.test(body), "Kaynak alıntı ilk değerine geri konmalıdır.");
  assert(
    /const locked = applySourceLock\(profile\.criteria, lock\)/.test(source),
    "Yayımlama akışı kaynak kilidini uygulamalıdır.",
  );

  const app = readFileSync("app/components/criteria-app.tsx", "utf8");
  assert(/locked-evidence-grid/.test(app), "Kaynak alanları salt okunur gösterilmelidir.");
  assert(
    !/update\(\{ sourcePage:/.test(app) && !/update\(\{ sourceText:/.test(app),
    "Arayüzde kaynak sayfa/alıntı düzenlenememelidir.",
  );
  assert(/Manuel kriter/.test(app), "Elle eklenen kriterde kaynak 'Manuel kriter' olarak işaretlenmelidir.");
}

/*
 * YAPAY ZEKÂ UYARISI (madde 10)
 * AI sonucunun gösterildiği her ekranda, sonucun HEMEN ALTINDA bulunur.
 */
{
  const { readFileSync } = await import("node:fs");
  const { AI_DISCLAIMER } = await import("../app/lib/types.ts");
  assert(/hata içerebilir/.test(AI_DISCLAIMER), "Uyarı metni hataya değinmelidir.");
  assert(/yetkili hakeme aittir/.test(AI_DISCLAIMER), "Uyarı metni nihai kararı hakeme bağlamalıdır.");
  for (const file of ["app/components/evaluation-app.tsx", "app/components/participant-portal.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert(/<AiDisclaimer/.test(source), `${file} AI uyarısını göstermelidir.`);
  }
  const disclaimer = readFileSync("app/components/ai-disclaimer.tsx", "utf8");
  assert(/AI_DISCLAIMER/.test(disclaimer), "Uyarı metni tek kaynaktan okunmalıdır.");
}

/*
 * GİRİŞ SİSTEMİ (madde 7)
 * Rol seçimli şifresiz kısayol kaldırıldı; tek giriş formu vardır.
 */
{
  const { readFileSync, existsSync } = await import("node:fs");
  assert(
    !existsSync("app/api/admin/dev-session/route.ts"),
    "Şifresiz rol kısayolu ucu kaldırılmalıdır.",
  );
  const login = readFileSync("app/components/access-login.tsx", "utf8");
  assert(!/devLogin/.test(login), "Giriş ekranında şifresiz rol kısayolu olmamalıdır.");
  assert(!/QUICK_ROLES/.test(login), "Giriş ekranında rol seçimi olmamalıdır.");
  assert(/Kullanıcı adı veya e-posta/.test(login), "Tek giriş formu kullanıcı adı kabul etmelidir.");

  const client = readFileSync("app/lib/admin-client.ts", "utf8");
  assert(!/dev-session/.test(client), "İstemci artık rol kısayolu ucunu çağırmamalıdır.");

  const session = readFileSync("app/api/admin/session/route.ts", "utf8");
  assert(/findCredentialsByIdentifier/.test(session), "Giriş kullanıcı adı veya e-posta ile yapılmalıdır.");
  // Rol İSTEK GÖVDESİNDEN okunmamalı; yalnızca hesabın kaydından gelmeli.
  assert(
    !/body\.roleCode|body\["roleCode"\]/.test(session),
    "Giriş isteğinde rol GÖNDERİLMEMELİDİR; rol veri tabanından okunur.",
  );
  assert(
    /credentials\.account\.roleCode/.test(session),
    "Rol, doğrulanan hesabın kaydından okunmalıdır.",
  );

  const bootstrap = readFileSync("app/api/admin/bootstrap/route.ts", "utf8");
  assert(/username: "admin"/.test(bootstrap), "Bootstrap hesabının kullanıcı adı 'admin' olmalıdır.");
  assert(/password: "1234"/.test(bootstrap), "Bootstrap hesabının geçici şifresi '1234' olmalıdır.");
  assert(/hashPassword\(DEV_ADMIN\.password\)/.test(bootstrap), "Şifre düz metin saklanmamalı, hash'lenmelidir.");
  assert(/if \(existing\)/.test(bootstrap), "İkinci çağrı ikinci Admin üretmemelidir (idempotent).");
  assert(/isProduction\(\)/.test(bootstrap), "Geliştirme kurulumu üretimde kapalı olmalıdır.");
  assert(/GELİŞTİRME\/DEMO/.test(bootstrap), "Hesabın yalnızca geliştirme/demo için olduğu belirtilmelidir.");
}

/*
 * KATILIMCI SONUCU (madde 9)
 * ONAY ve RED aynı kaynaktan, aynı anda görünür.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");
  assert(
    /const participantResultHidden = view === "participant" && !reviewCompleted;/.test(source),
    "Karar görünürlüğü yalnızca hakemin kararı kesinleştirmesine bağlı olmalıdır.",
  );
  assert(
    !/results_published", "archived"\]\.includes\(row\.competition_status/.test(source),
    "ONAY sonucu yarışma sonuçları yayımlanana kadar gizlenmemelidir.",
  );
  const portal = readFileSync("app/components/participant-portal.tsx", "utf8");
  assert(/participant-approval/.test(portal), "Onay sonucu için ayrı bir kutu gösterilmelidir.");
  assert(/Karar tarihi/.test(portal), "Onay sonucunda karar tarihi gösterilmelidir.");
  assert(/participant-decision-facts/.test(portal), "Yarışma, takım ve hakem bilgisi gösterilmelidir.");
}

/*
 * SOFT DELETE (maddeler 8 ve 11)
 * Arayüzdeki silme işlemleri kaydı yok etmez.
 */
{
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("app/lib/workflow-db.ts", "utf8");
  for (const fn of ["archiveApplication", "archiveCompetition"]) {
    const start = source.indexOf(`export async function ${fn}`);
    assert(start > 0, `${fn} bulunmalı.`);
    const body = source.slice(start, source.indexOf("\n/**", start + 10));
    assert(/SET deleted_at = \?/.test(body), `${fn} soft delete uygulamalıdır.`);
    assert(/deleted_by = \?/.test(body), `${fn} işlemi yapanı kaydetmelidir.`);
    assert(!/DELETE FROM/.test(body), `${fn} fiziksel silme YAPMAMALIDIR.`);
    assert(/recordWorkflowEvent/.test(body), `${fn} denetim kaydı yazmalıdır.`);
  }

  const reset = readFileSync("tools/dev_reset.mjs", "utf8");
  assert(/assertNotProduction/.test(reset), "Sıfırlama üretim ortamını reddetmelidir.");
  assert(/\.wrangler\/state\/v3\/d1/.test(reset), "Sıfırlama yalnızca yerel veri tabanına uygulanmalıdır.");
  assert(!/--remote/.test(reset), "Sıfırlama betiğinde uzak veri tabanı seçeneği bulunmamalıdır.");
  assert(/const apply = process\.argv\.includes\("--apply"\)/.test(reset), "Öntanımlı mod kuru çalıştırma olmalıdır.");
  assert(/BEGIN TRANSACTION/.test(reset) && /ROLLBACK/.test(reset), "Sıfırlama transaction içinde olmalıdır.");
}

console.log("Integrity, lifecycle and login regression tests: PASS");
