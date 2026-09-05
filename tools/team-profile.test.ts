/**
 * Takım üyesi bilgileri — form kuralları ve sunucu ayrıştırma testleri.
 *
 *   1. Eğitim durumuna uygun sınıf doğrulaması (mezunda sınıf sorulmaz).
 *   2. Başvuru sahibi dâhil takım büyüklüğü hesabı; boş kart sayılmaz.
 *   3. Yinelenen üye iki kez sayılmaz ve açık uyarı üretir.
 *   4. Duyuru kaynağı başvuru başına tek değerdir; kişi başına değil.
 *   5. Eski istemci yolu bütün alanları "Belirtilmedi" ile saklar.
 *   6. Seçenek listeleri: 81 il, ≥20 lise ve ≥20 üniversite önerisi.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DISCOVERY_SOURCE_OPTIONS,
  GRADE_OPTIONS_BY_EDUCATION,
  HIGH_SCHOOL_SUGGESTIONS,
  TURKEY_CITIES,
  UNIVERSITY_SUGGESTIONS,
  UNSPECIFIED,
  duplicateMemberNames,
  emptyTeamMember,
  gradeOptionsFor,
  isValidGrade,
  legacyTeamProfile,
  parseTeamProfile,
  teamSizeOf,
  toStoredTeamProfile,
  validateTeamProfile,
  type TeamMemberInput,
  type TeamProfileInput,
} from "../app/lib/team-profile.ts";

function person(patch: Partial<TeamMemberInput> = {}): TeamMemberInput {
  return {
    fullName: "Ada Yılmaz",
    gender: "",
    educationLevel: "bachelor",
    gradeLevel: "2",
    institution: "Orta Doğu Teknik Üniversitesi",
    city: "Ankara",
    teknofestHistory: "first",
    ...patch,
  };
}

function profile(patch: Partial<TeamProfileInput> = {}): TeamProfileInput {
  return { applicant: person(), members: [], discoverySource: "instagram", ...patch };
}

test("sınıf seçenekleri eğitim durumuna göre değişir; mezunda sınıf sorulmaz", () => {
  assert.deepEqual(gradeOptionsFor("high_school").map((option) => option.value), ["prep", "9", "10", "11", "12"]);
  assert.deepEqual(gradeOptionsFor("associate").map((option) => option.value), ["prep", "1", "2"]);
  assert.deepEqual(gradeOptionsFor("bachelor").map((option) => option.value), ["prep", "1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(gradeOptionsFor("master").map((option) => option.value), ["coursework", "thesis"]);
  assert.deepEqual(gradeOptionsFor("graduate"), []);
  assert.deepEqual(gradeOptionsFor(""), []);

  assert.ok(isValidGrade("high_school", "11"));
  assert.ok(!isValidGrade("high_school", "4"), "Lise için 4. sınıf yoktur.");
  assert.ok(!isValidGrade("associate", "3"), "Ön lisans için 3. sınıf yoktur.");
  assert.ok(isValidGrade("master", "thesis"));
  assert.ok(!isValidGrade("master", "1"));
  assert.ok(isValidGrade("graduate", ""), "Mezun için sınıf boş olmalı.");
  assert.ok(!isValidGrade("graduate", "4"), "Mezun için sınıf kabul edilmez.");

  // Doğrulama alan odaklı mesaj üretir.
  const wrong = validateTeamProfile(profile({ applicant: person({ educationLevel: "high_school", gradeLevel: "4" }) }));
  assert.ok(wrong.some((error) => error.field === "applicant.gradeLevel"), "Uyumsuz sınıf alan odaklı hata vermeli.");
  const graduate = validateTeamProfile(profile({ applicant: person({ educationLevel: "graduate", gradeLevel: "" }) }));
  assert.equal(graduate.length, 0, "Mezun + boş sınıf geçerlidir.");
  assert.equal(Object.keys(GRADE_OPTIONS_BY_EDUCATION).length, 5);
});

test("takım büyüklüğü başvuru sahibi dâhil hesaplanır; boş kart sayılmaz", () => {
  const applicant = person();
  assert.equal(teamSizeOf(applicant, []), 1, "Bireysel başvuru 1 kişidir.");
  assert.equal(teamSizeOf(applicant, [person({ fullName: "Deniz Kaya" }), emptyTeamMember(), person({ fullName: "   " })]), 2,
    "Adı yazılmamış kartlar takım büyüklüğüne sayılmaz.");
  const stored = toStoredTeamProfile(profile({ members: [person({ fullName: "Deniz Kaya" }), emptyTeamMember(), person({ fullName: "Ege Su" })] }));
  assert.equal(stored.teamSize, 3);
  assert.equal(stored.members.length, 2, "Boş kart saklanmaz.");
  assert.ok(stored.applicant.isApplicant && stored.members.every((member) => !member.isApplicant));
  // Boş kart doğrulamaya da girmez.
  assert.equal(validateTeamProfile(profile({ members: [emptyTeamMember()] })).length, 0);
});

test("yinelenen üye iki kez sayılmaz ve açık uyarı üretir", () => {
  const applicant = person({ fullName: "Ada Yılmaz" });
  const members = [person({ fullName: "ada yilmaz" }), person({ fullName: "Deniz Kaya" }), person({ fullName: "DENİZ  KAYA" })];
  assert.deepEqual(duplicateMemberNames(applicant, members).sort(), ["Ada Yılmaz", "Deniz Kaya"].sort());
  assert.equal(teamSizeOf(applicant, members), 2, "Aynı kişi (aksan/büyük harf farkıyla) bir kez sayılır.");
  const errors = validateTeamProfile(profile({ applicant, members }));
  assert.ok(errors.some((error) => error.field === "members" && /birden fazla kez/.test(error.message)), "Yineleme için anlaşılır uyarı olmalı.");
  assert.deepEqual(duplicateMemberNames(applicant, [person({ fullName: "Deniz Kaya" })]), []);
});

test("duyuru kaynağı başvuru başına tek değerdir; kişi kayıtlarında bulunmaz", () => {
  const stored = toStoredTeamProfile(profile({ members: [person({ fullName: "Deniz Kaya" }), person({ fullName: "Ege Su" })] }));
  assert.equal(stored.discoverySource, "instagram");
  for (const member of [stored.applicant, ...stored.members]) {
    assert.ok(!("discoverySource" in member), "Kişi kaydında duyuru kaynağı alanı olmamalı.");
  }
  assert.equal(DISCOVERY_SOURCE_OPTIONS.length, 14);
  const missing = validateTeamProfile(profile({ discoverySource: "" }));
  assert.ok(missing.some((error) => error.field === "discoverySource"), "Kaynak seçilmezse alan odaklı hata verilmeli.");
});

test("cinsiyet isteğe bağlı, diğer alanlar alan odaklı hata verir; sunucu allowlist uygular", () => {
  assert.equal(validateTeamProfile(profile({ applicant: person({ gender: "" }) })).length, 0, "Cinsiyet boş bırakılabilir.");
  const errors = validateTeamProfile(profile({
    applicant: person({ institution: "", city: "Atlantis", teknofestHistory: "" }),
    members: [person({ fullName: "Deniz Kaya", educationLevel: "" })],
  }));
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes("applicant.institution"));
  assert.ok(fields.includes("applicant.city"), "81 il dışındaki şehir reddedilmeli.");
  assert.ok(fields.includes("applicant.teknofestHistory"));
  assert.ok(fields.includes("members.0.educationLevel"));
  assert.ok(errors.every((error) => /Başvuru sahibi|1\. ekip üyesi/.test(error.message)), "Mesaj kişiyi ve alanı söylemeli.");

  const parsed = parseTeamProfile({
    applicant: { ...person(), gender: "robot", city: "Ankara" },
    members: [{ ...person({ fullName: "Deniz Kaya" }), teknofestHistory: "hundredth" }],
    discoverySource: "instagram",
  });
  assert.ok(!parsed.ok, "Allowlist dışı değer sunucuda reddedilmeli.");

  const ok = parseTeamProfile({
    applicant: person({ institution: "Listede Olmayan Bilim Lisesi", educationLevel: "high_school", gradeLevel: "11" }),
    members: [],
    discoverySource: "teacher_advisor",
  });
  assert.ok(ok.ok, "Listede olmayan kurum adı serbestçe yazılabilir.");
  if (ok.ok) assert.equal(ok.profile.applicant.institution, "Listede Olmayan Bilim Lisesi");
});

test("eski istemci yolu bütün alanları Belirtilmedi ile saklar", () => {
  const legacy = legacyTeamProfile("Ada Yılmaz", ["Deniz Kaya", "Ege Su"]);
  assert.equal(legacy.teamSize, 3);
  assert.equal(legacy.discoverySource, UNSPECIFIED);
  for (const member of [legacy.applicant, ...legacy.members]) {
    assert.equal(member.gender, UNSPECIFIED);
    assert.equal(member.educationLevel, UNSPECIFIED);
    assert.equal(member.gradeLevel, UNSPECIFIED);
    assert.equal(member.institution, UNSPECIFIED);
    assert.equal(member.city, UNSPECIFIED);
    assert.equal(member.teknofestHistory, UNSPECIFIED);
  }
  assert.ok(legacy.applicant.isApplicant);
  assert.deepEqual(legacy.members.map((member) => member.fullName), ["Deniz Kaya", "Ege Su"]);
});

test("seçenek listeleri: 81 il, en az 20 lise ve 20 üniversite önerisi", () => {
  assert.equal(TURKEY_CITIES.length, 81);
  assert.equal(new Set(TURKEY_CITIES).size, 81, "İl adları tekrar etmemeli.");
  assert.ok(TURKEY_CITIES.includes("İstanbul") && TURKEY_CITIES.includes("Düzce") && TURKEY_CITIES.includes("Adana"));
  assert.ok(HIGH_SCHOOL_SUGGESTIONS.length >= 20, "En az 20 lise önerisi olmalı.");
  assert.ok(UNIVERSITY_SUGGESTIONS.length >= 20, "En az 20 üniversite önerisi olmalı.");
});
