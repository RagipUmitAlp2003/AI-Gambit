/**
 * Yarışmacı katılım profili.
 *
 * Bu alanlar değerlendirme kararını etkilemez; yalnızca toplulaştırılmış
 * katılım, erişim kanalı ve başarı ilişkisi analizlerinde kullanılır.
 */

export const EDUCATION_STATUS_VALUES = ["lise", "on_lisans", "lisans", "yuksek_lisans", "mezun"] as const;
export type EducationStatus = typeof EDUCATION_STATUS_VALUES[number];

export const EDUCATION_STATUS_LABELS: Record<EducationStatus, string> = {
  lise: "Lise",
  on_lisans: "Ön lisans",
  lisans: "Lisans",
  yuksek_lisans: "Yüksek lisans",
  mezun: "Mezun",
};

export const EDUCATION_GRADE_OPTIONS: Record<EducationStatus, readonly string[]> = {
  lise: ["Hazırlık", "9. sınıf", "10. sınıf", "11. sınıf", "12. sınıf"],
  on_lisans: ["Hazırlık", "1. sınıf", "2. sınıf"],
  lisans: ["Hazırlık", "1. sınıf", "2. sınıf", "3. sınıf", "4. sınıf", "5. sınıf", "6. sınıf"],
  yuksek_lisans: ["Ders dönemi", "Tez dönemi"],
  mezun: [],
};

export const GENDER_VALUES = ["kadin", "erkek", "baska", "belirtmek_istemiyor"] as const;
export type Gender = typeof GENDER_VALUES[number];
export const GENDER_LABELS: Record<Gender, string> = {
  kadin: "Kadın",
  erkek: "Erkek",
  baska: "Başka bir tanım",
  belirtmek_istemiyor: "Belirtmek istemiyorum",
};

export const DISCOVERY_SOURCE_VALUES = [
  "instagram", "tiktok", "youtube", "x", "linkedin", "google", "teknofest",
  "okul_kulup", "ogretmen_danisman", "arkadas_takim", "gecmis_katilimci",
  "fiziksel_etkinlik", "tv_radyo", "diger",
] as const;
export type DiscoverySource = typeof DISCOVERY_SOURCE_VALUES[number];
export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  google: "Google / arama motoru",
  teknofest: "TEKNOFEST web sitesi veya uygulaması",
  okul_kulup: "Okul / üniversite kulübü",
  ogretmen_danisman: "Öğretmen / danışman",
  arkadas_takim: "Arkadaş / takım üyesi",
  gecmis_katilimci: "Geçmiş katılımcı",
  fiziksel_etkinlik: "Fiziksel etkinlik",
  tv_radyo: "TV / radyo",
  diger: "Diğer",
};

export const TEKNOFEST_HISTORY_VALUES = ["ilk", "ikinci", "ucuncu", "dorduncu", "bes_ve_uzeri"] as const;
export type TeknofestHistory = typeof TEKNOFEST_HISTORY_VALUES[number];
export const TEKNOFEST_HISTORY_LABELS: Record<TeknofestHistory, string> = {
  ilk: "İlk katılım",
  ikinci: "2. katılım",
  ucuncu: "3. katılım",
  dorduncu: "4. katılım",
  bes_ve_uzeri: "5. katılım veya üzeri",
};

export const TURKEY_CITIES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya", "Ardahan", "Artvin",
  "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur",
  "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan",
  "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkâri", "Hatay", "Iğdır", "Isparta", "İstanbul",
  "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kilis", "Kırıkkale", "Kırklareli",
  "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Mardin", "Mersin", "Muğla", "Muş",
  "Nevşehir", "Niğde", "Ordu", "Osmaniye", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas",
  "Şanlıurfa", "Şırnak", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak",
] as const;

export const DEMO_INSTITUTIONS = [
  "Ankara Fen Lisesi", "İstanbul Atatürk Fen Lisesi", "İzmir Fen Lisesi", "TÜBİTAK Fen Lisesi",
  "Galatasaray Lisesi", "İstanbul Erkek Lisesi", "Kabataş Erkek Lisesi", "Cağaloğlu Anadolu Lisesi",
  "Kadıköy Anadolu Lisesi", "Hüseyin Avni Sözen Anadolu Lisesi", "Beşiktaş Sakıp Sabancı Anadolu Lisesi",
  "Bornova Anadolu Lisesi", "İzmir Atatürk Lisesi", "Ankara Atatürk Lisesi", "Adana Fen Lisesi",
  "Bursa Tofaş Fen Lisesi", "Antalya Yusuf Ziya Öner Fen Lisesi", "Konya Meram Fen Lisesi",
  "Kayseri Fen Lisesi", "Trabzon Yomra Fen Lisesi",
  "Orta Doğu Teknik Üniversitesi", "İstanbul Teknik Üniversitesi", "Boğaziçi Üniversitesi", "Hacettepe Üniversitesi",
  "Yıldız Teknik Üniversitesi", "Gazi Üniversitesi", "Ege Üniversitesi", "Dokuz Eylül Üniversitesi",
  "Marmara Üniversitesi", "İstanbul Üniversitesi", "Ankara Üniversitesi", "Gebze Teknik Üniversitesi",
  "Karadeniz Teknik Üniversitesi", "Erciyes Üniversitesi", "Selçuk Üniversitesi", "Akdeniz Üniversitesi",
  "Çukurova Üniversitesi", "Sakarya Üniversitesi", "Bursa Teknik Üniversitesi", "Eskişehir Teknik Üniversitesi",
] as const;

export type ParticipantProfileInput = {
  educationStatus: EducationStatus;
  educationGrade: string;
  institutionName: string;
  city: string;
  gender: Gender | null;
  discoverySource: DiscoverySource;
  teknofestHistory: TeknofestHistory;
};

export type ParticipantProfile = ParticipantProfileInput & {
  accountId: string;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantProfileValidation =
  | { ok: true; value: ParticipantProfileInput }
  | { ok: false; error: string };

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

export function validateParticipantProfileInput(input: unknown): ParticipantProfileValidation {
  if (!input || typeof input !== "object") return { ok: false, error: "Katılım profili okunamadı." };
  const body = input as Record<string, unknown>;
  const educationStatus = enumValue(body.educationStatus, EDUCATION_STATUS_VALUES);
  if (!educationStatus) return { ok: false, error: "Eğitim durumu seçilmelidir." };
  const institutionName = typeof body.institutionName === "string" ? body.institutionName.trim() : "";
  if (!institutionName || institutionName.length > 180) return { ok: false, error: "Kurum adı 1–180 karakter arasında olmalıdır." };
  const city = typeof body.city === "string" ? body.city.trim() : "";
  if (!TURKEY_CITIES.includes(city as typeof TURKEY_CITIES[number])) return { ok: false, error: "Geçerli bir şehir seçilmelidir." };
  const discoverySource = enumValue(body.discoverySource, DISCOVERY_SOURCE_VALUES);
  if (!discoverySource) return { ok: false, error: "TEKNOFEST'i nereden duyduğunuzu seçin." };
  const teknofestHistory = enumValue(body.teknofestHistory, TEKNOFEST_HISTORY_VALUES);
  if (!teknofestHistory) return { ok: false, error: "TEKNOFEST katılım geçmişinizi seçin." };
  const genderWasOmitted = body.gender === "" || body.gender === null || body.gender === undefined;
  const gender = genderWasOmitted ? null : enumValue(body.gender, GENDER_VALUES);
  if (!genderWasOmitted && !gender) return { ok: false, error: "Cinsiyet seçimi geçerli değil." };
  const educationGrade = typeof body.educationGrade === "string" ? body.educationGrade.trim() : "";
  const gradeOptions = EDUCATION_GRADE_OPTIONS[educationStatus];
  if (gradeOptions.length && !gradeOptions.includes(educationGrade)) {
    return { ok: false, error: "Eğitim durumunuza uygun sınıf / aşama seçilmelidir." };
  }
  return {
    ok: true,
    value: {
      educationStatus,
      educationGrade: educationStatus === "mezun" ? "" : educationGrade,
      institutionName,
      city,
      gender,
      discoverySource,
      teknofestHistory,
    },
  };
}

