/**
 * Ucuz sinyalli aday daraltma (GÖREV 3 · madde 8 · CPU koruması).
 *
 * 768 boyutlu kosinüs karşılaştırması pahalıdır; sınırsız
 * `eş × kendiParça × eşParça` taraması Worker CPU sınırını aşar. Bu modül her
 * embedding vektörüne 64 bitlik bir İŞARET İZİ (rastgele izdüşüm işaretleri)
 * çıkarır: iki vektörün iz uzaklığı (Hamming) aradaki açıyı yaklaşıklar.
 * Kosinüs yalnızca iz uzaklığı `SKETCH_MAX_HAMMING` eşiğini geçen EN GÜÇLÜ
 * adaylara uygulanır; MinHash (doğrudan kopya) kanalı bundan ETKİLENMEZ.
 *
 * İz, kayıtlı vektörden YEREL olarak üretilir — hiçbir API çağrısı gerektirmez
 * ve embedding önbelleği anahtarını DEĞİŞTİRMEZ. İzi olmayan eski satırlarda
 * kapı açık kalır (tam kosinüs, eski davranış): daraltma yalnızca iki tarafta
 * da iz varken devreye girer, bu yüzden hiçbir eski kayıt karşılaştırma dışı
 * kalmaz.
 *
 * Saf ve ortamdan bağımsız modüldür; benzerlik kütüphanesinin başka hiçbir
 * dosyasını içe almaz (döngüsel bağımlılık yasak).
 */

/** İzdüşüm kural sürümü: işaret üretimi değişirse artırılır (izler yeniden üretilir). */
export const SKETCH_VERSION = "sketch-v1";
/** İz genişliği: 64 bit = hex 16 karakter. */
export const SKETCH_BITS = 64;
/**
 * Aday kapısı: iz uzaklığı bunun ÜZERİNDEYSE kosinüs hiç hesaplanmaz.
 * 20/64, kalibre eşik 0.82 kosinüsün beklenen uzaklığının (~12.4) yaklaşık
 * +2.4σ üstüdür: sınırdaki gerçek adaylar ~%99 olasılıkla kapıdan geçer,
 * alakasız çiftlerin (~32 uzaklık) neredeyse tamamı elenir. Daraltma yalnızca
 * ELEYEBİLİR; hiçbir puanı yükseltemez (yanlış suçlama üretmeme önceliği).
 */
export const SKETCH_MAX_HAMMING = 20;

/**
 * (bit, boyut) çifti için deterministik ±1 işareti üreten karma; SKETCH_VERSION
 * ile sürümlenir. Matris saklanmaz, gerektiğinde yeniden üretilir.
 */
function projectionMix(bit: number, dim: number): number {
  let h = (Math.imul(bit + 1, 0x9e3779b1) ^ Math.imul(dim + 1, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) | 0;
}

/** İşaret matrisi süreç başına BİR KEZ üretilir (64 × boyut); Int8Array olarak tutulur. */
const signMatrixCache = new Map<number, Int8Array>();

function signMatrix(dimensions: number): Int8Array {
  const cached = signMatrixCache.get(dimensions);
  if (cached) return cached;
  const matrix = new Int8Array(SKETCH_BITS * dimensions);
  for (let bit = 0; bit < SKETCH_BITS; bit += 1) {
    for (let dim = 0; dim < dimensions; dim += 1) {
      matrix[bit * dimensions + dim] = (projectionMix(bit, dim) & 1) === 1 ? 1 : -1;
    }
  }
  signMatrixCache.set(dimensions, matrix);
  return matrix;
}

/**
 * Vektörün 64 bitlik işaret izi (hex 16 karakter). Boş/geçersiz vektör null
 * döner: iz üretilemeyen parça daraltma kapısından MUAF kalır (tam kosinüs).
 */
export function embeddingSketch(vector: ReadonlyArray<number> | null | undefined): string | null {
  if (!vector || !vector.length) return null;
  const matrix = signMatrix(vector.length);
  let high = 0;
  let low = 0;
  for (let bit = 0; bit < SKETCH_BITS; bit += 1) {
    let sum = 0;
    const base = bit * vector.length;
    for (let dim = 0; dim < vector.length; dim += 1) {
      const value = vector[dim];
      if (!Number.isFinite(value)) return null;
      sum += value * matrix[base + dim];
    }
    if (sum >= 0) {
      if (bit < 32) high |= 1 << bit;
      else low |= 1 << (bit - 32);
    }
  }
  return (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
}

/** 32 bitlik bit sayımı (popcount). */
function popCount(value: number): number {
  let v = value | 0;
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return Math.imul(v, 0x01010101) >>> 24;
}

/**
 * İki izin Hamming uzaklığı (0–64). Biçimsiz iz "uzak" (SKETCH_BITS) sayılır;
 * bu durumda çağıran taraf kapıyı açık tutmayı kendisi seçer.
 */
export function sketchHamming(left: string, right: string): number {
  if (!/^[0-9a-f]{16}$/.test(left) || !/^[0-9a-f]{16}$/.test(right)) return SKETCH_BITS;
  const leftHigh = parseInt(left.slice(0, 8), 16);
  const leftLow = parseInt(left.slice(8), 16);
  const rightHigh = parseInt(right.slice(0, 8), 16);
  const rightLow = parseInt(right.slice(8), 16);
  return popCount(leftHigh ^ rightHigh) + popCount(leftLow ^ rightLow);
}

/**
 * Aday kapısı: kosinüs hesaplanmalı mı? İki tarafta da GEÇERLİ iz varsa
 * uzaklık eşiği uygulanır; iz eksik ya da biçimsizse kapı AÇIK kalır (eski
 * davranış — hiçbir eski kayıt karşılaştırma dışı bırakılmaz).
 */
export function semanticCandidateAllowed(
  ownSketch: string | null | undefined,
  peerSketch: string | null | undefined,
  maxHamming: number = SKETCH_MAX_HAMMING,
): boolean {
  if (!ownSketch || !peerSketch) return true;
  if (!/^[0-9a-f]{16}$/.test(ownSketch) || !/^[0-9a-f]{16}$/.test(peerSketch)) return true;
  return sketchHamming(ownSketch, peerSketch) <= maxHamming;
}

/** Parti planı: eş başvuru listesi sabit boyutlu partilere bölünür (madde 8). */
export function planBatches<T>(items: ReadonlyArray<T>, batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size) as T[]);
  }
  return batches;
}
