/**
 * AKIŞLI GÖVDE SINIRI (GÖREV 3 · madde 9) birim testleri — ağ çağrısı YAPMAZ.
 *
 *   - Content-Length sınır üstündeyse akış HİÇ okunmadan 413'e gider.
 *   - Content-Length eksikse istek otomatik güvenli SAYILMAZ: baytlar sayılır,
 *     sınır aşıldığı anda okuma iptal edilir (200 MB gövde belleğe alınmaz).
 *   - Boyut kapısı JSON/multipart ayrıştırmasından ÖNCE çalışır; boyut aşımı
 *     asla 400'e düşürülmez.
 *
 * Çalıştırma: npm run test:unit
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PayloadTooLargeError,
  configuredByteLimit,
  readBodyWithLimit,
  readFormDataWithLimit,
  requestBodyTooLarge,
} from "../app/lib/request-guard.ts";

/** Sayaçlı akış: kaç parça çekildiği ve iptal edilip edilmediği gözlenir. */
function instrumentedStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  counters: { pulls: number; cancelled: boolean };
} {
  const counters = { pulls: 0, cancelled: false };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      counters.pulls += 1;
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      counters.cancelled = true;
    },
    // highWaterMark 0: akış kurulurken istekli (eager) pull yapılmaz; sayaç
    // yalnızca gerçek read() çağrılarını ölçer.
  }, { highWaterMark: 0 });
  return { stream, counters };
}

/** Sahte istek: çıplak Headers korumasızdır, content-length elle yazılabilir. */
function stubRequest(input: { contentLength?: number; body: ReadableStream<Uint8Array> | null; contentType?: string }): Request {
  const headers = new Headers();
  if (input.contentLength !== undefined) headers.set("content-length", String(input.contentLength));
  if (input.contentType) headers.set("content-type", input.contentType);
  return { headers, body: input.body } as unknown as Request;
}

test("Content-Length sınır üstündeyse akış HİÇ okunmadan reddedilir (hızlı yol)", async () => {
  const { stream, counters } = instrumentedStream([new Uint8Array(1024)]);
  const request = stubRequest({ contentLength: 300 * 1024 * 1024, body: stream });
  await assert.rejects(readBodyWithLimit(request, 1024 * 1024), PayloadTooLargeError);
  assert.equal(counters.pulls, 0, "Beyan edilen boyut sınırı aşınca akıştan tek bayt bile okunmamalıdır.");
});

test("Content-Length EKSİK büyük chunked gövde belleğe alınmadan iptal edilir", async () => {
  // 64 KB'lik parçalarla sınırsız gövde; 1 MB sınırı ~16 parçada aşılmalı.
  const chunk = new Uint8Array(64 * 1024).fill(65);
  const { stream, counters } = instrumentedStream(Array.from({ length: 4096 }, () => chunk));
  const request = stubRequest({ body: stream });
  await assert.rejects(readBodyWithLimit(request, 1024 * 1024), PayloadTooLargeError);
  assert.ok(counters.cancelled, "Sınır aşıldığı anda akış iptal edilmelidir.");
  assert.ok(counters.pulls <= 20, `Okuma sınırın hemen ardında durmalıdır (pulls=${counters.pulls}).`);
});

test("sınır altındaki başlıksız akış BİREBİR baytlarla döner ve JSON gidiş-dönüşü çalışır", async () => {
  const payload = new TextEncoder().encode(JSON.stringify({ mesaj: "benzerlik", oran: 24 }));
  const { stream } = instrumentedStream([payload.slice(0, 5), payload.slice(5)]);
  const request = stubRequest({ body: stream });
  const bytes = await readBodyWithLimit(request, 1024);
  assert.deepEqual([...bytes], [...payload]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { mesaj: "benzerlik", oran: 24 });
});

test("boş/null gövde boş bayt dizisi döndürür (400 eşleniği readJson'da üretilir)", async () => {
  const request = stubRequest({ body: null });
  const bytes = await readBodyWithLimit(request, 1024);
  assert.equal(bytes.byteLength, 0);
});

test("KAPI-ÖNCE-PARSE: sınırı aşan BOZUK JSON bile PayloadTooLargeError üretir", async () => {
  // Bozuk JSON: ayrıştırma hiç başlamadığı için hata türü boyut hatasıdır.
  const junk = new Uint8Array(128 * 1024).fill(123); // "{{{..." benzeri
  const { stream } = instrumentedStream(Array.from({ length: 64 }, () => junk));
  const request = stubRequest({ body: stream });
  await assert.rejects(readBodyWithLimit(request, 256 * 1024), PayloadTooLargeError);
});

test("readFormDataWithLimit: sınır içi multipart ayrıştırılır, sınır üstü ayrıştırılmadan reddedilir", async () => {
  const boundary = "----kapiTesti123";
  const raw = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="alan"`,
    "",
    "deger",
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="rapor.txt"`,
    "Content-Type: text/plain",
    "",
    "rapor icerigi",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(raw);
  const okRequest = stubRequest({
    body: instrumentedStream([bytes]).stream,
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
  const form = await readFormDataWithLimit(okRequest, 64 * 1024);
  assert.equal(form.get("alan"), "deger");
  const file = form.get("file");
  assert.ok(file instanceof File && file.name === "rapor.txt");

  const bigRequest = stubRequest({
    body: instrumentedStream(Array.from({ length: 100 }, () => bytes)).stream,
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
  await assert.rejects(readFormDataWithLimit(bigRequest, 512), PayloadTooLargeError);
});

test("requestBodyTooLarge başlık tabanlı HIZLI reddir: eksik başlık false döner (tek başına kapı DEĞİL)", () => {
  // Bu davranış bilinçlidir ve pinlenir: eksik Content-Length "güvenli" demek
  // değildir; gerçek sınır her zaman readBodyWithLimit ile akışta uygulanır.
  assert.equal(requestBodyTooLarge(stubRequest({ body: null }), 10), false);
  assert.equal(requestBodyTooLarge(stubRequest({ contentLength: 11, body: null }), 10), true);
  assert.equal(requestBodyTooLarge(stubRequest({ contentLength: 9, body: null }), 10), false);
});

test("configuredByteLimit ortamdan okunur; geçersiz değer varsayılana düşer", () => {
  const key = "TEST_BYTE_LIMIT_X";
  delete process.env[key];
  assert.equal(configuredByteLimit(key, 2048), 2048);
  process.env[key] = "4096";
  assert.equal(configuredByteLimit(key, 2048), 4096);
  process.env[key] = "bozuk";
  assert.equal(configuredByteLimit(key, 2048), 2048);
  delete process.env[key];
});

/* ---------------- Kaynak pinleri (admin-guard Node'da yüklenemez) ---------------- */

const adminGuard = readFileSync(new URL("../app/lib/admin-guard.ts", import.meta.url), "utf8");

test("readJson akışlı bayt kapısını kullanır ve boyut aşımını 400'e DÜŞÜRMEZ", () => {
  assert.match(adminGuard, /readBodyWithLimit\(request,\s*maxBytes\)/,
    "readJson gövdeyi readBodyWithLimit ile okumalıdır (madde 9).");
  assert.match(adminGuard, /if \(error instanceof PayloadTooLargeError\) throw error;/,
    "Boyut aşımı ValidationError'a (400) çevrilmemelidir.");
  assert.match(adminGuard, /DEFAULT_JSON_BODY_BYTES = 2 \* 1024 \* 1024/,
    "Ortak JSON tavanı 2 MB olmalıdır (kullanıcı kararı).");
  assert.match(adminGuard, /configuredByteLimit\("REQUEST_JSON_MAX_BYTES"/,
    "Varsayılan tavan ortam değişkeniyle ayarlanabilir olmalıdır.");
});

test("handleError PayloadTooLargeError'ı 413 olarak eşler (ValidationError 400 kalır)", () => {
  const payloadBranch = adminGuard.indexOf("error instanceof PayloadTooLargeError");
  const validationBranch = adminGuard.indexOf("error instanceof ValidationError");
  assert.ok(payloadBranch > -1 && adminGuard.slice(payloadBranch, payloadBranch + 300).includes("413"),
    "handleError boyut aşımına 413 döndürmelidir.");
  assert.ok(validationBranch > -1, "ValidationError 400 eşlemesi korunmalıdır.");
});

test("benzerlik ucu gövdeyi 8 MB akış kapısıyla okur (madde 9)", () => {
  const route = readFileSync(new URL("../app/api/applications/[id]/similarity/route.ts", import.meta.url), "utf8");
  assert.match(route, /readJson\(request,\s*configuredByteLimit\("SIMILARITY_MAX_BODY_BYTES",\s*8 \* 1024 \* 1024\)\)/,
    "Benzerlik JSON gövdesi 8 MB akışlı tavanla okunmalıdır (kullanıcı kararı).");
});

test("gövde biriktiren diğer uçlar da akışlı kapıyı kullanır (request.formData kalmadı)", () => {
  for (const path of [
    "../app/api/applications/route.ts",
    "../app/api/applications/[id]/versions/route.ts",
    "../app/api/profiles/route.ts",
    "../app/api/analyze/route.ts",
    "../app/api/evaluate-report/route.ts",
    "../app/api/competitions/[id]/similarity-template/route.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(!/await request\.formData\(\)/.test(source),
      `${path} gövdeyi sınırsız request.formData() ile BİRİKTİRMEMELİDİR.`);
    assert.match(source, /readFormDataWithLimit\(/,
      `${path} akışlı multipart kapısını kullanmalıdır.`);
  }
});
