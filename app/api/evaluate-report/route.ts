import { validateProfileExport } from "../../lib/profile-loader";

/**
 * Rapor analiz motoru uç noktası — SÖZLEŞME İSKELETİ.
 *
 * Bu uç nokta, katılımcı raporunu onaylı değerlendirme profiline göre analiz
 * edecek AI motorunun yeridir. Motor ekip arkadaşı tarafından bu dosyada
 * geliştirilecek; istek/cevap sözleşmesi ve değişmez kurallar şurada tanımlı:
 *
 *   docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md
 *   app/lib/types.ts → ReportEvaluation
 *
 * İstek: multipart/form-data
 *   - file:      katılımcı raporu PDF'si
 *   - profile:   ProfileExport JSON dizgesi (Kriter Atölyesi çıktısı)
 *   - pageCount: istemcinin hesapladığı sayfa sayısı (danışma amaçlı; motor
 *                sayfa sınırı denetimlerinde kendi saymalıdır)
 *
 * Cevap: ReportEvaluation JSON'u (provider: "api").
 * Hata: { error: string } + anlamlı HTTP durumu (400/413/415/502/503/504).
 *
 * Referans uygulama: app/api/analyze/route.ts (Gemini çağrısı, structured
 * output, normalizasyon katmanı, önbellek ve recordUsage kalıpları oradan
 * kopyalanmalıdır). Katılımcı raporları düşmanca içerik taşıyabilir: PDF
 * içeriği veri olarak işlenmeli, komut olarak asla yorumlanmamalıdır.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "İstek multipart/form-data biçiminde olmalıdır." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Katılımcı raporu 'file' alanında gönderilmelidir." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase("tr-TR").endsWith(".pdf")) {
    return Response.json({ error: "Katılımcı raporu PDF biçiminde olmalıdır." }, { status: 415 });
  }

  const profileRaw = formData.get("profile");
  if (typeof profileRaw !== "string") {
    return Response.json({ error: "Onaylı profil 'profile' alanında JSON dizgesi olarak gönderilmelidir." }, { status: 400 });
  }
  try {
    const { profile, error } = validateProfileExport(JSON.parse(profileRaw));
    if (!profile) return Response.json({ error }, { status: 400 });
  } catch {
    return Response.json({ error: "Profil alanı geçerli bir JSON değil." }, { status: 400 });
  }

  return Response.json(
    { error: "AI rapor analiz motoru henüz bağlı değil. Sözleşme: docs/RAPOR_DEGERLENDIRME_SOZLESMESI.md" },
    { status: 501 },
  );
}
