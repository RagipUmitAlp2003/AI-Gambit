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
  flow_created: "Belge akışı oluşturuldu",
  flow_updated: "Belge akışı güncellendi",
  flow_handoff_added: "Belge devri eklendi",
  flow_deleted: "Belge akışı silindi",
};

export default function AuditPanel({ entries }: { entries: AuditEntryView[] }) {
  return (
    <section className="workspace" aria-labelledby="audit-title">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">Denetim izi</span>
          <h1 id="audit-title">Yönetim işlem kaydı</h1>
          <p>
            Hesap ve belge akışı üzerindeki kritik işlemler; işlemi yapan, hedef kayıt ve zaman damgasıyla birlikte
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
