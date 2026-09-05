"use client";

import { useId, useState, type ReactNode } from "react";
import {
  DISCOVERY_SOURCE_OPTIONS,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  INSTITUTION_SUGGESTIONS,
  MAX_TEAM_MEMBERS,
  MAX_TEXT_LENGTH,
  TEKNOFEST_HISTORY_OPTIONS,
  TURKEY_CITIES,
  countedMembers,
  duplicateMemberNames,
  emptyTeamMember,
  gradeLabel,
  gradeOptionsFor,
  labelOf,
  teamSizeOf,
  type EducationLevel,
  type TeamFieldError,
  type TeamMemberInput,
  type TeamProfileInput,
} from "../lib/team-profile";

/**
 * Takım üyesi kartları — yeniden kullanılabilir ekip formu.
 *
 * Başvuru sahibi ilk karttır; "Üye ekle" yeni kart açar; eklenen üyeler
 * silinebilir. Her kart, Kriter Atölyesindeki satır altı editör gibi tıklanınca
 * kendi satırının hemen altında açılır, tekrar tıklanınca kapanır. Eğitim
 * durumuna göre sınıf seçenekleri değişir; mezun için sınıf sorulmaz. Cinsiyet
 * isteğe bağlıdır. Toplam takım büyüklüğü başvuru sahibi dâhil, yalnızca adı
 * yazılmış satırlar üzerinden otomatik hesaplanır.
 *
 * Bilgiler başvuruya bağlı değişmez görüntü olarak saklanır; AI ve hakem
 * değerlendirmesini etkilemez (bkz. team-profile.ts).
 */

type EntryKey = "applicant" | `members.${number}`;

function Field({ label, hint, error, optional, children }: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${error ? " has-error" : ""}`}>
      <span className="field-label">{label}{optional ? <small className="field-optional"> · isteğe bağlı</small> : null}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function errorFor(errors: TeamFieldError[], field: string): string {
  return errors.find((error) => error.field === field)?.message ?? "";
}

function entryErrorCount(errors: TeamFieldError[], prefix: string): number {
  return errors.filter((error) => error.field.startsWith(`${prefix}.`)).length;
}

export default function TeamMembersEditor({ value, onChange, errors, applicantNameHint }: {
  value: TeamProfileInput;
  onChange: (next: TeamProfileInput) => void;
  /** Gönderme denemesinden sonra gösterilen alan odaklı hatalar. */
  errors: TeamFieldError[];
  /** Başvuru sahibinin adı üst formdan geldiğinde kartta salt okunur gösterilir. */
  applicantNameHint?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState<EntryKey | "">("applicant");
  const counted = countedMembers(value.members);
  const teamSize = teamSizeOf(value.applicant, value.members);
  const duplicates = duplicateMemberNames(value.applicant, value.members);

  function updateApplicant(patch: Partial<TeamMemberInput>) {
    onChange({ ...value, applicant: applyPatch(value.applicant, patch) });
  }

  function updateMember(index: number, patch: Partial<TeamMemberInput>) {
    onChange({ ...value, members: value.members.map((member, itemIndex) => itemIndex === index ? applyPatch(member, patch) : member) });
  }

  function applyPatch(member: TeamMemberInput, patch: Partial<TeamMemberInput>): TeamMemberInput {
    const next = { ...member, ...patch };
    // Eğitim durumu değişince önceki sınıf yeni listede yoksa temizlenir; mezunda hep boş.
    if (patch.educationLevel !== undefined) {
      const options = gradeOptionsFor(next.educationLevel);
      if (!options.some((option) => option.value === next.gradeLevel)) next.gradeLevel = "";
    }
    return next;
  }

  function addMember() {
    if (value.members.length >= MAX_TEAM_MEMBERS) return;
    const next = [...value.members, emptyTeamMember()];
    onChange({ ...value, members: next });
    setOpen(`members.${next.length - 1}`);
  }

  function removeMember(index: number) {
    onChange({ ...value, members: value.members.filter((_, itemIndex) => itemIndex !== index) });
    if (open === `members.${index}`) setOpen("");
  }

  function toggle(key: EntryKey) {
    setOpen((current) => current === key ? "" : key);
  }

  function renderPersonFields(prefix: string, member: TeamMemberInput, update: (patch: Partial<TeamMemberInput>) => void, nameEditable: boolean) {
    const gradeOptions = gradeOptionsFor(member.educationLevel);
    const graduate = member.educationLevel === "graduate";
    return (
      <div className="team-entry-body">
        <div className="form-grid two-col">
          {nameEditable ? (
            <Field label="Ad ve soyad" error={errorFor(errors, `${prefix}.fullName`)} hint="Yalnızca adı yazılmış satırlar takım büyüklüğüne sayılır.">
              <input value={member.fullName} maxLength={MAX_TEXT_LENGTH} autoComplete="off" onChange={(event) => update({ fullName: event.target.value })} />
            </Field>
          ) : (
            <Field label="Ad ve soyad" hint={applicantNameHint ?? "Üstteki “Başvuru sahibi adı soyadı” alanından alınır."}>
              <input value={member.fullName} readOnly aria-readonly="true" />
            </Field>
          )}
          <Field label="Cinsiyet" optional error={errorFor(errors, `${prefix}.gender`)} hint="Boş bırakılabilir; yalnızca toplu istatistikte kullanılır.">
            <select value={member.gender} onChange={(event) => update({ gender: event.target.value as TeamMemberInput["gender"] })}>
              <option value="">Seçilmedi</option>
              {GENDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Eğitim durumu" error={errorFor(errors, `${prefix}.educationLevel`)} hint="Sınıf seçenekleri buna göre değişir.">
            <select value={member.educationLevel} onChange={(event) => update({ educationLevel: event.target.value as EducationLevel | "" })}>
              <option value="">Seçin</option>
              {EDUCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field
            label="Sınıf / eğitim aşaması"
            error={errorFor(errors, `${prefix}.gradeLevel`)}
            hint={graduate ? "Mezun için sınıf sorulmaz." : member.educationLevel ? "Bulunduğunuz sınıfı veya dönemi seçin." : "Önce eğitim durumunu seçin."}
          >
            <select value={member.gradeLevel} disabled={!member.educationLevel || graduate} onChange={(event) => update({ gradeLevel: event.target.value })}>
              <option value="">{graduate ? "—" : "Seçin"}</option>
              {gradeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Okul / kurum adı" error={errorFor(errors, `${prefix}.institution`)} hint="Listeden seçebilir veya listede olmayan kurumu yazabilirsiniz.">
            <input list={`${listId}-institutions`} value={member.institution} maxLength={MAX_TEXT_LENGTH} autoComplete="off" onChange={(event) => update({ institution: event.target.value })} />
          </Field>
          <Field label="Şehir" error={errorFor(errors, `${prefix}.city`)} hint="Kurumun bulunduğu il.">
            <select value={member.city} onChange={(event) => update({ city: event.target.value })}>
              <option value="">Seçin</option>
              {TURKEY_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </Field>
          <Field label="TEKNOFEST geçmişi" error={errorFor(errors, `${prefix}.teknofestHistory`)} hint="Bu kişinin kaçıncı katılımı?">
            <select value={member.teknofestHistory} onChange={(event) => update({ teknofestHistory: event.target.value as TeamMemberInput["teknofestHistory"] })}>
              <option value="">Seçin</option>
              {TEKNOFEST_HISTORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
    );
  }

  function renderEntry(key: EntryKey, member: TeamMemberInput, index: number | null) {
    const isOpen = open === key;
    const prefix = key;
    const missing = entryErrorCount(errors, prefix);
    const isApplicant = index === null;
    const name = member.fullName.trim();
    return (
      <div key={key} className={`team-entry${isOpen ? " open" : ""}`}>
        <div className="team-entry-row">
          <button
            type="button"
            className="team-entry-toggle"
            aria-expanded={isOpen}
            aria-controls={`${listId}-${prefix.replace(".", "-")}`}
            onClick={() => toggle(key)}
          >
            <span className="team-entry-kicker">{isApplicant ? "Başvuru sahibi" : `${(index ?? 0) + 1}. ekip üyesi`}</span>
            <strong>{name || (isApplicant ? "Ad girilmedi" : "Adı henüz yazılmadı")}</strong>
            <span className="team-entry-chips">
              {member.educationLevel ? <span className="status-chip neutral">{labelOf(EDUCATION_OPTIONS, member.educationLevel)}{member.gradeLevel ? ` · ${gradeLabel(member.educationLevel, member.gradeLevel)}` : ""}</span> : null}
              {member.city ? <span className="status-chip neutral">{member.city}</span> : null}
              {missing ? <span className="status-chip danger">{missing} alan eksik</span> : null}
              {!isApplicant && !name ? <span className="status-chip warning">Sayılmıyor</span> : null}
            </span>
            <span className="criterion-chevron" aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
          </button>
          {!isApplicant ? (
            <button type="button" className="text-button team-entry-remove" onClick={() => removeMember(index ?? 0)}>Kaldır</button>
          ) : null}
        </div>
        {isOpen ? (
          <div id={`${listId}-${prefix.replace(".", "-")}`}>
            {isApplicant
              ? renderPersonFields("applicant", member, updateApplicant, false)
              : renderPersonFields(`members.${index}`, member, (patch) => updateMember(index ?? 0, patch), true)}
          </div>
        ) : null}
      </div>
    );
  }

  const listError = errorFor(errors, "members");
  return (
    <fieldset className="participant-members team-editor">
      <legend>Ekip bilgileri</legend>
      <p>
        Başvuru sahibi takımın bir üyesidir ve ilk kartta yer alır. Diğer üyeleri “Üye ekle” ile ekleyin;
        bireysel başvuruda yalnızca ilk kart yeterlidir. Bu bilgiler değerlendirmeyi etkilemez, yalnızca
        toplu katılım istatistiği için kullanılır.
      </p>
      <datalist id={`${listId}-institutions`}>
        {INSTITUTION_SUGGESTIONS.map((institution) => <option key={institution} value={institution} />)}
      </datalist>

      <div className="team-entry-list">
        {renderEntry("applicant", value.applicant, null)}
        {value.members.map((member, index) => renderEntry(`members.${index}`, member, index))}
      </div>

      <div className="team-editor-footer">
        <button type="button" className="secondary-button" disabled={value.members.length >= MAX_TEAM_MEMBERS} onClick={addMember}>Üye ekle</button>
        <div className="team-size-summary" aria-live="polite">
          <strong>Toplam takım büyüklüğü: {teamSize}</strong>
          <small>Başvuru sahibi dâhil · {counted.length} ek üye sayıldı{value.members.length > counted.length ? ` · ${value.members.length - counted.length} boş kart sayılmadı` : ""}</small>
        </div>
      </div>
      {duplicates.length ? (
        <p className="inline-error team-editor-warning" role="alert">
          <strong>Aynı kişi birden fazla kez girilmiş:</strong> {duplicates.join(", ")}. Yinelenen adlar takım büyüklüğüne bir kez sayılır; lütfen fazla kartı kaldırın.
        </p>
      ) : null}
      {listError && !duplicates.length ? <p className="inline-error team-editor-warning" role="alert">{listError}</p> : null}

      <div className="team-discovery">
        <Field
          label="TEKNOFEST’i nereden duydunuz?"
          error={errorFor(errors, "discoverySource")}
          hint="Takım için yalnızca bir kez sorulur; kişi başına tekrar edilmez."
        >
          <select value={value.discoverySource} onChange={(event) => onChange({ ...value, discoverySource: event.target.value as TeamProfileInput["discoverySource"] })}>
            <option value="">Seçin</option>
            {DISCOVERY_SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </div>
    </fieldset>
  );
}
