/**
 * Takım üyesi demografi ve eğitim bilgileri — ORTAK, SAF modül.
 *
 * Yarışmacı portalındaki ekip formu, /api/applications ucu, workflow-db ve
 * birim testleri aynı seçenek listelerini ve doğrulama kurallarını buradan
 * okur. Bu bilgiler HESAP tablosuna değil, BAŞVURUYA bağlı takım üyesi
 * satırlarına yazılır: kullanıcı sonraki bir başvuruda farklı okul/sınıf
 * verirse eski başvurunun tarihsel görüntüsü değişmez.
 *
 * Bu alanlar AI değerlendirmesini, kriter sonuçlarını, hakem kararını,
 * benzerlik hesabını ve kabul/ret sonucunu HİÇBİR biçimde etkilemez;
 * yalnızca Değerlendirme Yöneticisinin toplulaştırılmış analitiğinde kullanılır.
 */

/** Eski başvurularda bulunmayan her alanın karşılığı. */
export const UNSPECIFIED = "unspecified" as const;
export const UNSPECIFIED_LABEL = "Belirtilmedi";

export type Gender = "female" | "male" | "other" | "prefer_not_to_say";
export type EducationLevel = "high_school" | "associate" | "bachelor" | "master" | "graduate";
export type TeknofestHistory = "first" | "second" | "third" | "fourth" | "fifth_plus";
export type DiscoverySource =
  | "instagram" | "tiktok" | "youtube" | "x" | "linkedin" | "search_engine" | "teknofest_site"
  | "school_club" | "teacher_advisor" | "friend_or_teammate" | "past_participant"
  | "physical_event" | "tv_radio" | "other";

export const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: "female", label: "Kadın" },
  { value: "male", label: "Erkek" },
  { value: "other", label: "Başka bir tanım" },
  { value: "prefer_not_to_say", label: "Belirtmek istemiyorum" },
];

export const EDUCATION_OPTIONS: ReadonlyArray<{ value: EducationLevel; label: string }> = [
  { value: "high_school", label: "Lise" },
  { value: "associate", label: "Ön lisans" },
  { value: "bachelor", label: "Lisans" },
  { value: "master", label: "Yüksek lisans" },
  { value: "graduate", label: "Mezun" },
];

/**
 * Eğitim durumuna göre sınıf / eğitim aşaması seçenekleri.
 * "Mezun" seçildiğinde sınıf SORULMAZ (boş liste).
 */
export const GRADE_OPTIONS_BY_EDUCATION: Record<EducationLevel, ReadonlyArray<{ value: string; label: string }>> = {
  high_school: [
    { value: "prep", label: "Hazırlık" },
    { value: "9", label: "9. sınıf" },
    { value: "10", label: "10. sınıf" },
    { value: "11", label: "11. sınıf" },
    { value: "12", label: "12. sınıf" },
  ],
  associate: [
    { value: "prep", label: "Hazırlık" },
    { value: "1", label: "1. sınıf" },
    { value: "2", label: "2. sınıf" },
  ],
  bachelor: [
    { value: "prep", label: "Hazırlık" },
    { value: "1", label: "1. sınıf" },
    { value: "2", label: "2. sınıf" },
    { value: "3", label: "3. sınıf" },
    { value: "4", label: "4. sınıf" },
    { value: "5", label: "5. sınıf" },
    { value: "6", label: "6. sınıf" },
  ],
  master: [
    { value: "coursework", label: "Ders dönemi" },
    { value: "thesis", label: "Tez dönemi" },
  ],
  graduate: [],
};

export const TEKNOFEST_HISTORY_OPTIONS: ReadonlyArray<{ value: TeknofestHistory; label: string }> = [
  { value: "first", label: "İlk katılım" },
  { value: "second", label: "2. katılım" },
  { value: "third", label: "3. katılım" },
  { value: "fourth", label: "4. katılım" },
  { value: "fifth_plus", label: "5 veya daha fazla katılım" },
];

/** Başvuru/takım başına YALNIZCA bir kez sorulur; kişi başına değil. */
export const DISCOVERY_SOURCE_OPTIONS: ReadonlyArray<{ value: DiscoverySource; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "search_engine", label: "Google veya başka bir arama motoru" },
  { value: "teknofest_site", label: "TEKNOFEST web sitesi/uygulaması" },
  { value: "school_club", label: "Okul veya üniversite kulübü" },
  { value: "teacher_advisor", label: "Öğretmen/danışman" },
  { value: "friend_or_teammate", label: "Arkadaş veya takım üyesi" },
  { value: "past_participant", label: "Geçmiş katılımcı" },
  { value: "physical_event", label: "Fiziksel etkinlik" },
  { value: "tv_radio", label: "TV/radyo" },
  { value: "other", label: "Diğer" },
];

/** Türkiye'nin 81 ili, plaka sırasıyla. */
export const TURKEY_CITIES: readonly string[] = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir",
  "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
  "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkâri",
  "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
  "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir",
  "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat",
  "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman",
  "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye",
  "Düzce",
];

/** Kurum önerileri: en az 20 lise ve 20 üniversite. Listede olmayan ad serbestçe yazılabilir. */
export const HIGH_SCHOOL_SUGGESTIONS: readonly string[] = [
  "Ankara Fen Lisesi", "İstanbul Erkek Lisesi", "Galatasaray Lisesi", "Kabataş Erkek Lisesi", "İzmir Fen Lisesi",
  "Bornova Anadolu Lisesi", "Cağaloğlu Anadolu Lisesi", "Ankara Atatürk Lisesi", "Bursa Anadolu Lisesi", "Adana Fen Lisesi",
  "Kayseri Fen Lisesi", "Konya Meram Fen Lisesi", "Eskişehir Fatih Fen Lisesi", "Samsun Garip Zeycan Yıldırım Fen Lisesi",
  "Trabzon Yomra Fen Lisesi", "Gaziantep Fen Lisesi", "Kocaeli Fen Lisesi", "Antalya Fen Lisesi", "Denizli Erbakır Fen Lisesi",
  "Malatya Fen Lisesi", "Hüseyin Avni Sözen Anadolu Lisesi", "Beşiktaş Atatürk Anadolu Lisesi",
];

export const UNIVERSITY_SUGGESTIONS: readonly string[] = [
  "Orta Doğu Teknik Üniversitesi", "İstanbul Teknik Üniversitesi", "Boğaziçi Üniversitesi", "Bilkent Üniversitesi",
  "Hacettepe Üniversitesi", "Ankara Üniversitesi", "İstanbul Üniversitesi", "Yıldız Teknik Üniversitesi",
  "Ege Üniversitesi", "Dokuz Eylül Üniversitesi", "İzmir Yüksek Teknoloji Enstitüsü", "Gebze Teknik Üniversitesi",
  "Sabancı Üniversitesi", "Koç Üniversitesi", "Gazi Üniversitesi", "Marmara Üniversitesi", "Karadeniz Teknik Üniversitesi",
  "Erciyes Üniversitesi", "Bursa Uludağ Üniversitesi", "Selçuk Üniversitesi", "Atatürk Üniversitesi", "Çukurova Üniversitesi",
  "Kocaeli Üniversitesi", "Sakarya Üniversitesi", "Eskişehir Teknik Üniversitesi", "TOBB Ekonomi ve Teknoloji Üniversitesi",
];

export const INSTITUTION_SUGGESTIONS: readonly string[] = [...HIGH_SCHOOL_SUGGESTIONS, ...UNIVERSITY_SUGGESTIONS];

export const MAX_TEAM_MEMBERS = 30;
export const MAX_TEXT_LENGTH = 120;

/** Formdaki tek kişinin bilgileri (başvuru sahibi de aynı yapıdadır). */
export type TeamMemberInput = {
  fullName: string;
  /** İsteğe bağlı; boş bırakılabilir. */
  gender: Gender | "";
  educationLevel: EducationLevel | "";
  /** Mezun için boş kalır. */
  gradeLevel: string;
  institution: string;
  city: string;
  teknofestHistory: TeknofestHistory | "";
};

/** Başvuru başına gönderilen ekip bilgisi. */
export type TeamProfileInput = {
  applicant: TeamMemberInput;
  members: TeamMemberInput[];
  /** Başvuru/takım başına tek değer. */
  discoverySource: DiscoverySource | "";
};

/** Sunucuda doğrulanmış ve saklanmaya hazır kişi kaydı. */
export type StoredTeamMember = {
  fullName: string;
  isApplicant: boolean;
  gender: Gender | typeof UNSPECIFIED;
  educationLevel: EducationLevel | typeof UNSPECIFIED;
  gradeLevel: string | typeof UNSPECIFIED;
  institution: string | typeof UNSPECIFIED;
  city: string | typeof UNSPECIFIED;
  teknofestHistory: TeknofestHistory | typeof UNSPECIFIED;
};

export type StoredTeamProfile = {
  applicant: StoredTeamMember;
  members: StoredTeamMember[];
  discoverySource: DiscoverySource | typeof UNSPECIFIED;
  /** Başvuru sahibi dâhil. */
  teamSize: number;
};

export function emptyTeamMember(fullName = ""): TeamMemberInput {
  return { fullName, gender: "", educationLevel: "", gradeLevel: "", institution: "", city: "", teknofestHistory: "" };
}

export function emptyTeamProfile(applicantName = ""): TeamProfileInput {
  return { applicant: emptyTeamMember(applicantName), members: [], discoverySource: "" };
}

export function gradeOptionsFor(education: EducationLevel | "" | typeof UNSPECIFIED): ReadonlyArray<{ value: string; label: string }> {
  if (!education || education === UNSPECIFIED) return [];
  return GRADE_OPTIONS_BY_EDUCATION[education] ?? [];
}

/** Sınıf, seçili eğitim durumunun listesinde olmalı; mezunda boş olmalı. */
export function isValidGrade(education: EducationLevel, grade: string): boolean {
  const options = GRADE_OPTIONS_BY_EDUCATION[education];
  if (!options.length) return grade === "";
  return options.some((option) => option.value === grade);
}

export function isEducationLevel(value: unknown): value is EducationLevel {
  return typeof value === "string" && EDUCATION_OPTIONS.some((option) => option.value === value);
}
export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && GENDER_OPTIONS.some((option) => option.value === value);
}
export function isTeknofestHistory(value: unknown): value is TeknofestHistory {
  return typeof value === "string" && TEKNOFEST_HISTORY_OPTIONS.some((option) => option.value === value);
}
export function isDiscoverySource(value: unknown): value is DiscoverySource {
  return typeof value === "string" && DISCOVERY_SOURCE_OPTIONS.some((option) => option.value === value);
}
export function isTurkeyCity(value: unknown): value is string {
  return typeof value === "string" && TURKEY_CITIES.includes(value);
}

/** Ad karşılaştırması: Türkçe küçük harf, aksan katlaması, fazla boşluk. */
export function normalizePersonName(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöçâîû]/g, (character) => ({ ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" }[character] ?? character))
    .replace(/\s+/g, " ")
    .trim();
}

/** Yalnızca adı yazılmış GERÇEK üye satırları sayılır; boş kart sayılmaz. */
export function countedMembers(members: TeamMemberInput[]): TeamMemberInput[] {
  return members.filter((member) => member.fullName.trim().length > 0);
}

/** Başvuru sahibi dâhil takım büyüklüğü. Yinelenen adlar bir kez sayılır. */
export function teamSizeOf(applicant: Pick<TeamMemberInput, "fullName">, members: TeamMemberInput[]): number {
  const names = new Set<string>();
  const applicantName = normalizePersonName(applicant.fullName);
  if (applicantName) names.add(applicantName);
  for (const member of countedMembers(members)) names.add(normalizePersonName(member.fullName));
  // Başvuru sahibi adı boşsa bile başvuru sahibi takımın bir üyesidir.
  return applicantName ? names.size : names.size + 1;
}

/** Aynı kişi yanlışlıkla iki kez girildiyse (başvuru sahibi dâhil) adları döner. */
export function duplicateMemberNames(applicant: Pick<TeamMemberInput, "fullName">, members: TeamMemberInput[]): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  const all = [applicant.fullName, ...countedMembers(members).map((member) => member.fullName)];
  for (const raw of all) {
    const key = normalizePersonName(raw);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(seen.get(key) ?? raw.trim());
    else seen.set(key, raw.trim());
  }
  return [...duplicates];
}

export type TeamFieldError = { field: string; message: string };

const PERSON_FIELD_LABELS: Record<keyof TeamMemberInput, string> = {
  fullName: "ad ve soyad",
  gender: "cinsiyet",
  educationLevel: "eğitim durumu",
  gradeLevel: "sınıf / eğitim aşaması",
  institution: "okul/kurum adı",
  city: "şehir",
  teknofestHistory: "TEKNOFEST geçmişi",
};

function personErrors(prefix: string, who: string, member: TeamMemberInput): TeamFieldError[] {
  const errors: TeamFieldError[] = [];
  const push = (field: keyof TeamMemberInput, message: string) => errors.push({ field: `${prefix}.${field}`, message });
  if (!member.fullName.trim()) push("fullName", `${who}: ${PERSON_FIELD_LABELS.fullName} boş bırakılamaz.`);
  else if (member.fullName.trim().length > MAX_TEXT_LENGTH) push("fullName", `${who}: ad ve soyad en fazla ${MAX_TEXT_LENGTH} karakter olabilir.`);
  // Cinsiyet isteğe bağlıdır; verilmişse allowlist'te olmalı.
  if (member.gender && !isGender(member.gender)) push("gender", `${who}: cinsiyet seçimi geçersiz.`);
  if (!member.educationLevel) push("educationLevel", `${who}: ${PERSON_FIELD_LABELS.educationLevel} seçilmelidir.`);
  else if (!isEducationLevel(member.educationLevel)) push("educationLevel", `${who}: eğitim durumu geçersiz.`);
  else if (!isValidGrade(member.educationLevel, member.gradeLevel)) {
    push("gradeLevel", member.educationLevel === "graduate"
      ? `${who}: mezun için sınıf seçilmez.`
      : `${who}: seçili eğitim durumuna uygun bir ${PERSON_FIELD_LABELS.gradeLevel} seçilmelidir.`);
  }
  if (!member.institution.trim()) push("institution", `${who}: ${PERSON_FIELD_LABELS.institution} boş bırakılamaz.`);
  else if (member.institution.trim().length > MAX_TEXT_LENGTH) push("institution", `${who}: kurum adı en fazla ${MAX_TEXT_LENGTH} karakter olabilir.`);
  if (!member.city) push("city", `${who}: ${PERSON_FIELD_LABELS.city} seçilmelidir.`);
  else if (!isTurkeyCity(member.city)) push("city", `${who}: şehir 81 il listesinden seçilmelidir.`);
  if (!member.teknofestHistory) push("teknofestHistory", `${who}: ${PERSON_FIELD_LABELS.teknofestHistory} seçilmelidir.`);
  else if (!isTeknofestHistory(member.teknofestHistory)) push("teknofestHistory", `${who}: TEKNOFEST geçmişi geçersiz.`);
  return errors;
}

/**
 * Formun bütününü doğrular. Boş üye kartları (adı yazılmamış) YOK sayılır;
 * yalnızca adı yazılmış satırlar zorunlu alan denetiminden geçer.
 */
export function validateTeamProfile(input: TeamProfileInput): TeamFieldError[] {
  const errors: TeamFieldError[] = [];
  errors.push(...personErrors("applicant", "Başvuru sahibi", input.applicant));
  input.members.forEach((member, index) => {
    if (!member.fullName.trim()) return;
    errors.push(...personErrors(`members.${index}`, `${index + 1}. ekip üyesi`, member));
  });
  if (countedMembers(input.members).length > MAX_TEAM_MEMBERS) {
    errors.push({ field: "members", message: `Bir başvuruda başvuru sahibi dışında en fazla ${MAX_TEAM_MEMBERS} ekip üyesi kaydedilebilir.` });
  }
  const duplicates = duplicateMemberNames(input.applicant, input.members);
  if (duplicates.length) {
    errors.push({ field: "members", message: `Aynı kişi birden fazla kez girilmiş: ${duplicates.join(", ")}. Her üye yalnızca bir kez yazılmalıdır.` });
  }
  if (!input.discoverySource) errors.push({ field: "discoverySource", message: "TEKNOFEST'i nereden duyduğunuzu seçin (takım için bir kez)." });
  else if (!isDiscoverySource(input.discoverySource)) errors.push({ field: "discoverySource", message: "Duyuru kaynağı geçersiz." });
  return errors;
}

function storedMember(member: TeamMemberInput, isApplicant: boolean): StoredTeamMember {
  const education = isEducationLevel(member.educationLevel) ? member.educationLevel : UNSPECIFIED;
  return {
    fullName: member.fullName.trim(),
    isApplicant,
    gender: isGender(member.gender) ? member.gender : UNSPECIFIED,
    educationLevel: education,
    gradeLevel: education !== UNSPECIFIED && education !== "graduate" && isValidGrade(education, member.gradeLevel)
      ? member.gradeLevel
      : UNSPECIFIED,
    institution: member.institution.trim() || UNSPECIFIED,
    city: isTurkeyCity(member.city) ? member.city : UNSPECIFIED,
    teknofestHistory: isTeknofestHistory(member.teknofestHistory) ? member.teknofestHistory : UNSPECIFIED,
  };
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim().slice(0, 400) : "";
}

function readMember(raw: unknown): TeamMemberInput | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  return {
    fullName: readString(source, "fullName"),
    gender: readString(source, "gender") as TeamMemberInput["gender"],
    educationLevel: readString(source, "educationLevel") as TeamMemberInput["educationLevel"],
    gradeLevel: readString(source, "gradeLevel"),
    institution: readString(source, "institution"),
    city: readString(source, "city"),
    teknofestHistory: readString(source, "teknofestHistory") as TeamMemberInput["teknofestHistory"],
  };
}

export type ParsedTeamProfile =
  | { ok: true; profile: StoredTeamProfile }
  | { ok: false; error: string };

/**
 * Sunucu tarafı ayrıştırma: istemciden gelen JSON'u allowlist'lerle doğrular.
 * Hata varsa İLK alan odaklı mesaj döner; başarıda saklanmaya hazır kayıt.
 */
export function parseTeamProfile(raw: unknown): ParsedTeamProfile {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Ekip bilgileri okunamadı." };
  const source = raw as Record<string, unknown>;
  const applicant = readMember(source.applicant);
  if (!applicant) return { ok: false, error: "Başvuru sahibi bilgileri eksik." };
  if (!Array.isArray(source.members)) return { ok: false, error: "Ekip üyeleri geçerli bir liste olmalıdır." };
  const members = source.members.map(readMember).filter((member): member is TeamMemberInput => !!member);
  const input: TeamProfileInput = {
    applicant,
    members,
    discoverySource: readString(source, "discoverySource") as TeamProfileInput["discoverySource"],
  };
  const errors = validateTeamProfile(input);
  if (errors.length) return { ok: false, error: errors[0].message };
  return { ok: true, profile: toStoredTeamProfile(input) };
}

/** Doğrulanmış girdiyi saklama biçimine çevirir (yalnızca adı yazılmış üyeler). */
export function toStoredTeamProfile(input: TeamProfileInput): StoredTeamProfile {
  const applicant = storedMember(input.applicant, true);
  const members = countedMembers(input.members).map((member) => storedMember(member, false));
  return {
    applicant,
    members,
    discoverySource: isDiscoverySource(input.discoverySource) ? input.discoverySource : UNSPECIFIED,
    teamSize: teamSizeOf(input.applicant, input.members),
  };
}

/**
 * Eski istemci yolu: yalnızca ad listesi geldiğinde bütün alanlar
 * "Belirtilmedi" olarak saklanır; eski başvurular bozulmaz.
 */
export function legacyTeamProfile(applicantFullName: string, memberNames: string[]): StoredTeamProfile {
  const applicant: StoredTeamMember = {
    fullName: applicantFullName.trim(), isApplicant: true, gender: UNSPECIFIED, educationLevel: UNSPECIFIED,
    gradeLevel: UNSPECIFIED, institution: UNSPECIFIED, city: UNSPECIFIED, teknofestHistory: UNSPECIFIED,
  };
  const members = memberNames.map((name) => ({ ...applicant, fullName: name.trim(), isApplicant: false }));
  return {
    applicant,
    members,
    discoverySource: UNSPECIFIED,
    teamSize: teamSizeOf({ fullName: applicantFullName }, members.map((member) => ({ ...emptyTeamMember(member.fullName) }))),
  };
}

/** Etiket çözücüler — tablo ve grafiklerde ham kodu değil okunur adı gösterir. */
export function labelOf<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: string): string {
  if (value === UNSPECIFIED || !value) return UNSPECIFIED_LABEL;
  return options.find((option) => option.value === value)?.label ?? value;
}

export function gradeLabel(education: string, grade: string): string {
  if (!grade || grade === UNSPECIFIED) return UNSPECIFIED_LABEL;
  if (!isEducationLevel(education)) return grade;
  return GRADE_OPTIONS_BY_EDUCATION[education].find((option) => option.value === grade)?.label ?? grade;
}
