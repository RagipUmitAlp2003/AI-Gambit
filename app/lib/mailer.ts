import { roleByCode } from "./admin-roles";
import { isProduction } from "./session";
import type { MailProvider, MailStatus, RoleCode } from "./admin-types";

/**
 * Çift modlu e-posta katmanı.
 * `RESEND_API_KEY` ve `MAIL_FROM` tanımlıysa mail gerçekten gönderilir;
 * tanımlı değilse "giden kutusu" kaydına düşer ve panelde görünür.
 * Kod aynı kalır, ortam değişkeni eklendiğinde gerçek gönderime geçer.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Giden kutusu kaydında şifrenin yerine yazılan maske. */
export const PASSWORD_MASK = "••••••••";

export type MailEnvelope = {
  to: string;
  subject: string;
  /** Gerçek gönderime giden, şifreyi içeren gövde. */
  body: string;
  /** Veri tabanına yazılan, şifresi maskelenmiş gövde. */
  storedBody: string;
};

export type MailOutcome = {
  status: MailStatus;
  provider: MailProvider;
  error: string | null;
};

export type AccountMailInput = {
  fullName: string;
  email: string;
  roleCode: RoleCode;
  password: string;
  loginUrl: string;
};

export function buildAccountMail(input: AccountMailInput): MailEnvelope {
  const role = roleByCode(input.roleCode);
  const roleLine = role ? `${role.code} · ${role.title}` : input.roleCode;
  // null satırlar atlanır; "" satırları paragraf aralığı olarak korunur.
  const lines = (password: string): Array<string | null> => [
    `Sayın ${input.fullName},`,
    "",
    "Kriter Atölyesi değerlendirme sistemi için yönetici hesabınız oluşturuldu.",
    "",
    `Rol: ${roleLine}`,
    role ? `Görev tanımı: ${role.summary}` : null,
    `Kullanıcı adı (e-posta): ${input.email}`,
    `Tek kullanımlık şifre: ${password}`,
    `Giriş adresi: ${input.loginUrl}`,
    "",
    "Bu şifre yalnızca ilk giriş içindir; giriş yaptıktan sonra kendi şifrenizi belirlemeniz beklenir.",
    "Hesabı siz talep etmediyseniz bu mesajı yok sayın ve rol atayıcıya bildirin.",
    "",
    "Kriter Atölyesi · Yönetim",
  ];
  const render = (password: string) =>
    lines(password)
      .filter((line): line is string => line !== null)
      .join("\n");

  return {
    to: input.email,
    subject: `Kriter Atölyesi yönetici hesabınız · Rol ${input.roleCode}`,
    body: render(input.password),
    storedBody: render(PASSWORD_MASK),
  };
}

export function buildRevokeMail(input: { fullName: string; email: string; roleCode: RoleCode; reason: string }): MailEnvelope {
  const role = roleByCode(input.roleCode);
  const body = ([
    `Sayın ${input.fullName},`,
    "",
    `Kriter Atölyesi sistemindeki ${role ? `${role.code} · ${role.title}` : input.roleCode} rolünüz kaldırıldı.`,
    input.reason ? `Gerekçe: ${input.reason}` : null,
    "Hesabınız pasife alındığı için sisteme giriş yapamazsınız.",
    "",
    "Kriter Atölyesi · Yönetim",
  ] as Array<string | null>)
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    to: input.email,
    subject: "Kriter Atölyesi rol kaldırma bildirimi",
    body,
    storedBody: body,
  };
}

export type ApplicationOutcomeMailInput = {
  fullName: string;
  email: string;
  teamName: string;
  competitionName: string;
  outcome: "accepted" | "rejected" | "revision_required";
  /** Hakemin (gerekirse AI taslağından düzenlediği) gerekçesi. */
  reason: string;
  portalUrl: string;
};

const OUTCOME_HEADLINE: Record<ApplicationOutcomeMailInput["outcome"], string> = {
  accepted: "Başvurunuz kabul edildi",
  rejected: "Başvurunuz reddedildi",
  revision_required: "Başvurunuzda düzeltme isteniyor",
};

/**
 * Hakem nihai kararı verdiğinde yarışmacıya giden bildirim.
 * Ret kararında gerekçe gövdenin ana parçasıdır: yarışmacı neden reddedildiğini
 * hem bu mesajda hem de portaldaki başvuru kaydında görür.
 */
export function buildApplicationOutcomeMail(input: ApplicationOutcomeMailInput): MailEnvelope {
  const headline = OUTCOME_HEADLINE[input.outcome];
  const reason = input.reason.trim();
  const render = (reasonText: string) => ([
    `Sayın ${input.fullName},`,
    "",
    `${input.competitionName} yarışmasına "${input.teamName}" takımıyla yaptığınız başvuru hakem tarafından değerlendirildi.`,
    "",
    `Sonuç: ${headline}.`,
    reasonText ? "" : null,
    reasonText ? (input.outcome === "rejected" ? "Ret gerekçesi:" : "Hakem açıklaması:") : null,
    reasonText || null,
    "",
    `Başvurunuzun güncel durumunu sistemden de görebilirsiniz: ${input.portalUrl}`,
    input.outcome === "revision_required"
      ? "Düzeltilmiş raporunuzu aynı başvuruya yeni sürüm olarak yükleyebilirsiniz; eski sürümünüz silinmez."
      : null,
    "",
    "AI-Gambit · Değerlendirme Sistemi",
  ] as Array<string | null>)
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    to: input.email,
    subject: `${input.competitionName} · ${headline}`,
    body: render(reason),
    // Gerekçe, katılımcı PDF'inden alıntı taşıyabilir; giden kutusunu okuyan
    // yönetici rolleri rapor içeriği görmez — kayıtta maskelenir.
    storedBody: render(reason ? "[Gerekçe yarışmacıya iletildi; kayıtta rapor içeriği taşımaması için maskelendi.]" : ""),
  };
}

export function mailProviderReady(env: Cloudflare.Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

export async function deliverMail(env: Cloudflare.Env, envelope: MailEnvelope): Promise<MailOutcome> {
  if (!mailProviderReady(env)) {
    // Üretimde giden kutusu yedeği kapalıdır: gönderilmemiş bir bildirim
    // "bekliyor" gibi görünmemeli, açıkça başarısız sayılmalıdır.
    if (isProduction()) {
      console.error("[mail] üretim ortamında mail sağlayıcı tanımlı değil; bildirim gönderilemedi.");
      return {
        status: "failed",
        provider: "outbox",
        error: "Üretim ortamında mail sağlayıcı tanımlı değil; bildirim gönderilemedi.",
      };
    }
    return {
      status: "queued",
      provider: "outbox",
      error: "Mail sağlayıcı anahtarı tanımlı değil; mesaj giden kutusuna alındı.",
    };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [envelope.to],
        subject: envelope.subject,
        text: envelope.body,
        ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
      }),
    });

    if (!response.ok) {
      // Sağlayıcı yanıtı anahtar parçası veya iç kimlik içerebilir; yalnızca
      // sunucu loguna yazılır, istemciye durum kodu döner.
      console.error("[mail] sağlayıcı hatası", response.status, (await response.text()).slice(0, 300));
      return {
        status: "failed",
        provider: "resend",
        error: `Mail sağlayıcı ${response.status} döndürdü.`,
      };
    }

    return { status: "sent", provider: "resend", error: null };
  } catch (error) {
    console.error("[mail] gönderim hatası", error);
    return {
      status: "failed",
      provider: "resend",
      error: "Mail gönderimi başarısız oldu.",
    };
  }
}
