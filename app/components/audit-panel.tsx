"use client";

import { formatDateTime } from "../lib/admin-client";
import type { AuditEntryView } from "../lib/admin-client";

/**
 * Denetim izi görünümü (yalnızca Rol 00).
 * Kayıtlarda parola, oturum jetonu veya anahtar bulunmaz.
 */

const ACTION_LABELS: Record<string, string> = {
  login: "Giriş yapıldı",
  logout: "Çıkış yapıldı",
  login_denied_inactive: "Pasif hesapla giriş denendi",
  bootstrap_moderator_created: "İlk moderatör kuruldu",
  account_created: "Hesap oluşturuldu",
  account_role_changed: "Rol değiştirildi",
  account_revoked: "Rol kaldırıldı",
  account_restored: "Hesap yeniden aktifleştirildi",
  account_purged: "Hesap kalıcı silindi",
  participant_registered: "Yarışmacı hesabı açıldı",
  // Aşama A · profil hazırlama ve ikinci doğrulama
  profile_submitted_for_review: "Profil hakem incelemesine gönderildi",
  profile_approved: "Profil hakem tarafından onaylandı",
  profile_changes_requested: "Hakem profil için düzeltme istedi",
  // Aşama B–D · başvuru, AI ön değerlendirmesi ve nihai karar
  application_submitted: "Yarışmacı başvurusu alındı",
  start_analysis: "AI ön değerlendirmesi başlatıldı",
  save_evaluation: "AI ön değerlendirmesi kaydedildi",
  analysis_failed: "AI analizi başarısız oldu",
  save_review: "Hakem değerlendirmesi kaydedildi",
};

export default function AuditPanel({ entries }: { entries: AuditEntryView[] }) {
  return (
    <section className="workspace" aria-labelledby="audit-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Denetim izi</span>
          <h1 id="audit-title">Yönetim işlem kaydı</h1>
          <p>
            Hesap yönetimi ve değerlendirme süreci üzerindeki kritik işlemler; işlemi yapan, hedef kayıt ve zaman damgasıyla birlikte
            tutulur. Kayıtlarda şifre, oturum jetonu veya API anahtarı bulunmaz.
          </p>
        </div>
        <span className="step-fraction">{entries.length} kayıt</span>
      </div>

      <div className="admin-list">
        {entries.length === 0 ? (
          <p className="empty-note">Henüz kayıt yok.</p>
        ) : (
          <ul className="audit-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="audit-time">{formatDateTime(entry.createdAt)}</span>
                <div>
                  <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
                  <small>
                    {entry.actorEmail ? `${entry.actorEmail}${entry.actorRole ? ` · ${entry.actorRole}` : ""}` : "sistem"}
                  </small>
                  {entry.detail ? <p>{entry.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
