#!/usr/bin/env node
/**
 * GEMINI_API_KEY ve yapılandırılan model adlarını Gemini API'ye karşı doğrular.
 *
 * "Belge analiz edilemedi" hatasının kaynağı kota mı, kimlik doğrulama mı,
 * yoksa geçersiz model adı mı olduğunu tek komutla ayırt eder. Anahtar
 * hiçbir zaman ekrana yazılmaz; yalnızca uzunluk ve ön ek gösterilir.
 *
 * Kullanım: node tools/check_gemini_access.mjs
 */
import fs from "node:fs";

const readEnvFile = (path) => {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^\s*\w+\s*=/.test(line) && !line.trimStart().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
};

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = { ...fileEnv, ...process.env };
const apiKey = env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("HATA: GEMINI_API_KEY bulunamadı (.env.local veya ortam değişkeni).");
  process.exit(1);
}

console.log(`Anahtar: ${apiKey.length} karakter, ön ek "${apiKey.slice(0, 4)}…"`);
console.log("Anahtar biçimi yerelde doğrulanmaz; geçerliliğe API'nin yanıtı karar verir.");

const models = [
  env.GEMINI_MODEL || "gemini-3-flash-preview",
  env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite",
];

const request = async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "x-goog-api-key": apiKey, ...(init.headers || {}) },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  } catch (error) {
    return { status: 0, payload: { error: { message: `ağ/zaman aşımı: ${error.name}` } } };
  } finally {
    clearTimeout(timer);
  }
};

let failed = false;

console.log("\n1) Kimlik doğrulama (models.list)");
const list = await request("https://generativelanguage.googleapis.com/v1beta/models?pageSize=300");
if (list.status === 200) {
  const available = (list.payload.models || []).map((model) => model.name.replace("models/", ""));
  console.log(`   OK — ${available.length} model erişilebilir.`);
  for (const model of models) {
    const exists = available.includes(model);
    if (!exists) failed = true;
    console.log(`   ${exists ? "OK" : "EKSİK"} — yapılandırılan model "${model}"`);
    if (!exists) {
      const close = available.filter((name) => name.includes("flash")).slice(0, 8);
      console.log(`      benzer erişilebilir modeller: ${close.join(", ") || "-"}`);
    }
  }
} else {
  failed = true;
  const detail = list.payload?.error;
  console.log(`   BAŞARISIZ — HTTP ${list.status} ${detail?.status || ""}`);
  console.log(`   ${detail?.message || "ayrıntı yok"}`);
  if (list.status === 401 || list.status === 403) {
    console.log("   → Kota değil kimlik sorunu. Google AI Studio'dan yeni bir API anahtarı alın");
    console.log("     ve .env.local içindeki GEMINI_API_KEY değerini güncelleyin.");
  }
}

console.log("\n2) Üretim çağrısı (generateContent)");
for (const model of models) {
  const probe = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 16 },
      }),
    },
  );
  if (probe.status === 200) {
    console.log(`   OK — ${model}`);
    continue;
  }
  failed = true;
  const detail = probe.payload?.error?.message || "ayrıntı yok";
  console.log(`   BAŞARISIZ — ${model}: HTTP ${probe.status} ${probe.payload?.error?.status || ""}`);
  console.log(`      ${detail.slice(0, 200)}`);
  if (/prepayment credits|billing|quota/i.test(detail)) {
    console.log("      → Anahtar geçerli; projenin faturalama bakiyesi tükenmiş.");
    console.log("        https://ai.dev/projects adresinden kredi/faturalama yükleyin.");
  } else if (probe.status === 429) {
    console.log("      → Anlık hız sınırı. Kısa bir bekleyişten sonra tekrar deneyin.");
  } else if (probe.status === 503) {
    console.log("      → Model geçici olarak yoğun. Yeniden deneme veya yedek model çözer.");
  } else if (probe.status === 404) {
    console.log("      → Model adı bu projeye kapalı. Erişilebilir bir ada geçin.");
  }
}

if (failed && list.status === 200) {
  console.log("\n3) Çalışan alternatif model taraması");
  const usable = (list.payload.models || [])
    .filter((model) => (model.supportedGenerationMethods || []).includes("generateContent"))
    .map((model) => model.name.replace("models/", ""))
    .filter((name) => /flash|pro/.test(name) && !/image|tts|audio|live|omni|robotics|research|computer-use|banana|lyria/.test(name))
    .filter((name) => !models.includes(name));
  const working = [];
  for (const model of usable) {
    const probe = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 8 } }),
      },
    );
    if (probe.status === 200) working.push(model);
  }
  console.log(working.length
    ? `   Çalışan modeller: ${working.join(", ")}\n   GEMINI_MODEL / GEMINI_FALLBACK_MODEL bunlardan biriyle güncellenebilir.`
    : "   Hiçbir model üretim çağrısına yanıt vermedi; sorun model adı değil hesap/bakiye düzeyinde.");
}

console.log(failed ? "\nSonuç: AI analizi bu yapılandırmayla çalışmaz." : "\nSonuç: yapılandırma çalışıyor.");
process.exit(failed ? 1 : 0);
