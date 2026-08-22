import type {
  AnalysisResult,
  Confidence,
  Criterion,
  EvaluationMethod,
  SetupData,
} from "./types";

const lowerTR = (value: string) => value.toLocaleLowerCase("tr-TR");

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

function contains(text: string, phrase: string) {
  return lowerTR(text).includes(lowerTR(phrase));
}

function pageFor(pages: string[], phrase: string) {
  const index = pages.findIndex((page) => contains(page, phrase));
  return index >= 0 ? index + 1 : null;
}

function quoteAround(pages: string[], phrase: string, fallback: string) {
  const page = pages.find((candidate) => contains(candidate, phrase));
  if (!page) return fallback;
  const source = clean(page);
  const index = lowerTR(source).indexOf(lowerTR(phrase));
  if (index < 0) return fallback;
  const start = Math.max(0, source.lastIndexOf(".", Math.max(0, index - 1)) + 1);
  const nextDot = source.indexOf(".", index + phrase.length);
  const end = nextDot > -1 ? Math.min(source.length, nextDot + 1) : Math.min(source.length, index + 260);
  return clean(source.slice(start, end));
}

type CriterionInput = Omit<Criterion, "id" | "active" | "origin">;

function criterion(index: number, input: CriterionInput): Criterion {
  return {
    id: `criterion-${index + 1}`,
    active: true,
    origin: "document",
    ...input,
  };
}

function addIf(
  target: Criterion[],
  condition: boolean,
  input: Omit<CriterionInput, "sourcePage"> & { sourcePhrase: string; sourcePage?: number | null },
  pages: string[],
) {
  if (!condition) return;
  const { sourcePhrase, sourcePage, ...rest } = input;
  target.push(
    criterion(target.length, {
      ...rest,
      sourcePage: sourcePage ?? pageFor(pages, sourcePhrase),
    }),
  );
}

const scoringDefinitions: Array<{
  name: string;
  score: number;
  focus: string;
  method: EvaluationMethod;
  confidence: Confidence;
}> = [
  {
    name: "Problem Tanımı ve Gereksinim Analizi",
    score: 10,
    focus: "Problemin açıklığı, hedef kullanıcı ve ölçülebilir gereksinimler birlikte değerlendirilir.",
    method: "ai",
    confidence: "high",
  },
  {
    name: "Özgünlük ve Yenilikçi Değer",
    score: 20,
    focus: "Mevcut çözümlerden fark ve karşılaştırma kanıtları incelenir; nihai özgünlük yorumu jüriye bırakılır.",
    method: "hybrid",
    confidence: "high",
  },
  {
    name: "Teknik Tasarım Yeterliliği",
    score: 25,
    focus: "Mimari, bileşen seçimi, veri akışı ve teknik gerekçeler bütüncül değerlendirilir; alt başlıklara ayrı puan uydurulmaz.",
    method: "hybrid",
    confidence: "high",
  },
  {
    name: "Yöntem ve Doğrulama Planı",
    score: 15,
    focus: "Test senaryoları, başarı ölçütleri ve tekrar edilebilirlik kanıtları aranır.",
    method: "ai",
    confidence: "high",
  },
  {
    name: "Uygulanabilirlik ve Proje Planı",
    score: 15,
    focus: "İş paketleri, takvim, kaynaklar ve risk azaltma adımları incelenir.",
    method: "hybrid",
    confidence: "high",
  },
  {
    name: "Yaygın Etki ve Sürdürülebilirlik",
    score: 10,
    focus: "Kullanıcı faydası, ölçeklenebilirlik ve sürdürülebilir kullanım gerekçeleri incelenir.",
    method: "ai",
    confidence: "high",
  },
  {
    name: "Raporlama Açıklığı ve Kaynak Kullanımı",
    score: 5,
    focus: "Anlatım bütünlüğü, şekil ve tablo açıklamaları ile atıfların yeterliliği incelenir.",
    method: "hybrid",
    confidence: "high",
  },
];

export async function analyzeWithDemoProvider(
  pages: string[],
  setup: SetupData,
): Promise<AnalysisResult> {
  // API geldiğinde yalnızca bu sağlayıcı değişecek. Arayüz ve kriter veri modeli aynı kalacak.
  const fullText = clean(pages.join(" "));
  const criteria: Criterion[] = [];

  const formatPhrase = "tek bir PDF dosyası";
  addIf(criteria, contains(fullText, formatPhrase), {
    name: "Teslim dosyası PDF olmalıdır",
    type: "technical_upload",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "Yüklemeyi engelle",
    evaluationMethod: "deterministic",
    sourcePhrase: formatPhrase,
    sourceText: quoteAround(pages, formatPhrase, "Rapor tek bir PDF dosyası olarak yüklenmelidir."),
    aiInterpretation: "Bu madde katılımcı teslimi için kesin ve otomatik uygulanabilir bir dosya biçimi kuralıdır.",
    confidence: "high",
  }, pages);

  const sizeMatch = fullText.match(/en fazla\s+(\d+)\s*MB/i);
  if (sizeMatch) {
    const documentLimit = Number(sizeMatch[1]);
    const issue = documentLimit !== setup.maxFileSizeMb
      ? `Başlangıç ayarı ${setup.maxFileSizeMb} MB, belgede ise ${documentLimit} MB. Geçerli sınırı yönetici seçmelidir.`
      : undefined;
    addIf(criteria, true, {
      name: `Dosya büyüklüğü en fazla ${documentLimit} MB olmalıdır`,
      type: "technical_upload",
      maxScore: null,
      weight: null,
      required: true,
      violationOutcome: "Yüklemeyi engelle",
      evaluationMethod: "deterministic",
      sourcePhrase: sizeMatch[0],
      sourceText: quoteAround(pages, sizeMatch[0], `Yüklenen dosya en fazla ${documentLimit} MB olabilir.`),
      aiInterpretation: "Sayısal sınır açıkça verildiği için dosya boyutu kod ile kesin olarak kontrol edilebilir.",
      confidence: "high",
      issue,
    }, pages);
  }

  const countPhrase = "yalnızca bir rapor dosyası";
  addIf(criteria, contains(fullText, countPhrase), {
    name: "Takım başına yalnızca bir dosya kabul edilir",
    type: "technical_upload",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "Fazla dosyayı reddet",
    evaluationMethod: "deterministic",
    sourcePhrase: countPhrase,
    sourceText: quoteAround(pages, countPhrase, "Takım başına yalnızca bir rapor dosyası kabul edilir."),
    aiInterpretation: "Dosya adedi açıkça sınırlandırılmıştır ve yükleme sırasında otomatik kontrol edilebilir.",
    confidence: "high",
  }, pages);

  const pageMatch = fullText.match(/en fazla\s+(\d+)\s+sayfa/i);
  if (pageMatch) {
    const limit = Number(pageMatch[1]);
    addIf(criteria, true, {
      name: `Rapor en fazla ${limit} sayfa olmalıdır`,
      type: "format_rule",
      maxScore: null,
      weight: null,
      required: true,
      violationOutcome: "Jüri uyarısı oluştur",
      evaluationMethod: "deterministic",
      sourcePhrase: pageMatch[0],
      sourceText: quoteAround(pages, pageMatch[0], `Rapor, kapak ve kaynakça hariç en fazla ${limit} sayfa olmalıdır.`),
      aiInterpretation: "Sayfa sınırı vardır; kapak ve kaynakçanın hesaba katılmaması kontrol uygulanırken özel olarak ele alınmalıdır.",
      confidence: "high",
    }, pages);
  }

  addIf(criteria, contains(fullText, "A4 boyutunda"), {
    name: "Sayfa boyutu A4 olmalıdır",
    type: "format_rule",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "Jüri uyarısı oluştur",
    evaluationMethod: "deterministic",
    sourcePhrase: "A4 boyutunda",
    sourceText: quoteAround(pages, "A4 boyutunda", "Rapor A4 boyutunda hazırlanmalıdır."),
    aiInterpretation: "PDF sayfa ölçüleri teknik olarak kontrol edilebilir; farklı boyuttaki sayfalar ayrıca raporlanmalıdır.",
    confidence: "high",
  }, pages);

  const marginPhrase = "2,5 cm boşluk";
  addIf(criteria, contains(fullText, marginPhrase), {
    name: "Tüm kenarlarda 2,5 cm boşluk kullanılmalıdır",
    type: "format_rule",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "Jüri uyarısı oluştur",
    evaluationMethod: "deterministic",
    sourcePhrase: marginPhrase,
    sourceText: quoteAround(pages, marginPhrase, "Tüm kenarlarda 2,5 cm boşluk kullanılmalıdır."),
    aiInterpretation: "Kenar boşluğu kuralı açık; ölçüm bazı PDF'lerde yaklaşık sonuç verebileceği için ihlal doğrudan eleme olmamalıdır.",
    confidence: "medium",
  }, pages);

  const requiredPhrase = "Zorunlu bölümler";
  addIf(criteria, contains(fullText, requiredPhrase), {
    name: "Zorunlu rapor bölümlerinin varlığı",
    type: "mandatory_content",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "İlgili puan kriterinde eksiklik olarak göster",
    evaluationMethod: "hybrid",
    sourcePhrase: requiredPhrase,
    sourceText: quoteAround(
      pages,
      requiredPhrase,
      "Problem Tanımı, Mevcut Çözümler, Önerilen Sistem Mimarisi, Yöntem, Doğrulama ve Test Planı, Risk ve Etik Değerlendirme ile Kaynakça bölümleri bulunmalıdır.",
    ),
    aiInterpretation: "Başlıkların yalnızca birebir adı değil, eş anlamlı bölüm başlıkları da aranmalıdır. Eksiklik doğrudan eleme değildir.",
    confidence: "high",
  }, pages);

  for (const definition of scoringDefinitions) {
    if (!contains(fullText, definition.name)) continue;
    criteria.push(criterion(criteria.length, {
      name: definition.name,
      type: "qualitative_score",
      maxScore: definition.score,
      weight: definition.score,
      required: true,
      violationOutcome: "Gerekçeli puan önerisi oluştur",
      evaluationMethod: definition.method,
      sourcePage: pageFor(pages, definition.name),
      sourceText: `${definition.name} - Azami ${definition.score} puan. ${definition.focus}`,
      aiInterpretation: definition.focus,
      confidence: definition.confidence,
    }));
  }

  const similarityPhrase = "yüzde 20'yi aşması";
  addIf(criteria, contains(fullText, similarityPhrase), {
    name: "Belge benzerlik oranı yüzde 20'yi aşmamalıdır",
    type: "elimination_review",
    maxScore: null,
    weight: null,
    required: true,
    violationOutcome: "Eleme incelemesi başlat; kararı jüriye bırak",
    evaluationMethod: "hybrid",
    sourcePhrase: similarityPhrase,
    sourceText: quoteAround(pages, similarityPhrase, "Belge benzerlik oranının yüzde 20'yi aşması eleme incelemesi başlatır."),
    aiInterpretation: "Bu madde normal puan kriteri değildir. Sistem benzerlik bulgusunu raporlar ancak doğrudan eleme kararı vermez.",
    confidence: "high",
  }, pages);

  const aiDisclosurePhrase = "kullanım amacı ve kapsamı";
  addIf(criteria, contains(fullText, aiDisclosurePhrase), {
    name: "Yapay zekâ kullanım açıklaması bulunmalıdır",
    type: "mandatory_content",
    maxScore: null,
    weight: null,
    required: false,
    violationOutcome: "Etik inceleme uyarısı oluştur",
    evaluationMethod: "hybrid",
    sourcePhrase: aiDisclosurePhrase,
    sourceText: quoteAround(pages, aiDisclosurePhrase, "Yapay zekâ kullanım amacı ve kapsamı raporun sonunda açıklanmalıdır."),
    aiInterpretation: "Belge bu açıklamanın eksikliğini otomatik eleme saymıyor; yalnızca etik inceleme uyarısı istiyor.",
    confidence: "high",
  }, pages);

  const skippedChecks = ["Yazı tipi", "Punto", "Satır aralığı"].filter((check) => {
    const normalized = lowerTR(fullText);
    if (check === "Yazı tipi") return !normalized.match(/(arial|times new roman|calibri)\s*(yazı tipi|font)?/);
    if (check === "Punto") return !normalized.match(/\b(9|10|11|12|14)\s*punto\b/);
    return !normalized.match(/satır aralığı\s*(1|1,15|1,5|2)/);
  });

  return {
    criteria,
    skippedChecks,
    informationalNotes: contains(fullText, "tek başına ek bir puanlama kriteri oluşturmaz")
      ? ["Genel amaç bölümündeki toplumsal fayda beklentisi, belge açıkça kriter olmadığını söylediği için ayrı kriter yapılmadı."]
      : [],
    conflicts: criteria.filter((item) => Boolean(item.issue)).length,
    pageCount: pages.length,
    provider: "demo",
    analyzedAt: new Date().toISOString(),
  };
}
