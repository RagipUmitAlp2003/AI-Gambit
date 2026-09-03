/**
 * PDF.js'in sunucu (Cloudflare Workers / workerd) ortamında ihtiyaç duyduğu
 * tarayıcı globallerinin asgari karşılıkları.
 *
 * NEDEN GEREKLİ: `pdfjs-dist` paketi modül gövdesinde `new DOMMatrix()`
 * çağırır (`SCALE_MATRIX`). Node'da bu global `@napi-rs/canvas` paketinden
 * gelir; workerd'de ise ne o paket ne de DOM vardır, bu yüzden PDF.js'i içe
 * aktarmanın kendisi `ReferenceError: DOMMatrix is not defined` ile patlıyordu
 * ve şartname analizi "beklenmeyen hata" ile 500 dönüyordu.
 *
 * KAPSAM: yalnızca metin ve konum çıkarımı desteklenir. Çizim (canvas) yolları
 * sunucuda hiç çalıştırılmaz; bu yüzden `Path2D` yalnızca yapıyı ayakta tutan
 * bir kabuktur, gerçek bir yol geometrisi tutmaz. `DOMMatrix` ise gerçek bir
 * 2B afin dönüşüm uygular: PDF.js metin katmanında `a…f` alanlarını okur.
 */

type MatrixInit = number[] | Float32Array | Float64Array | string | undefined;

/** Sırayla [a, b, c, d, e, f]. 16 elemanlı 3B girdiden 2B bileşen alınır. */
function readInit(init: MatrixInit): [number, number, number, number, number, number] {
  if (!init || typeof init === "string") return [1, 0, 0, 1, 0, 0];
  const values = Array.from(init as ArrayLike<number>, (value) => Number(value) || 0);
  if (values.length >= 16) return [values[0], values[1], values[4], values[5], values[12], values[13]];
  if (values.length >= 6) return [values[0], values[1], values[2], values[3], values[4], values[5]];
  return [1, 0, 0, 1, 0, 0];
}

class ServerDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: MatrixInit) {
    const [a, b, c, d, e, f] = readInit(init);
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }

  /** Tarayıcı DOMMatrix'i m11…m42 takma adlarını da sunar; PDF.js ikisini de okur. */
  get m11() { return this.a; }
  get m12() { return this.b; }
  get m21() { return this.c; }
  get m22() { return this.d; }
  get m41() { return this.e; }
  get m42() { return this.f; }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private set6(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    return this;
  }

  /** this × other (tarayıcıdaki sıra: soldaki this, sağdaki other). */
  multiplySelf(other?: MatrixInit | ServerDOMMatrix): this {
    const m = other instanceof ServerDOMMatrix ? other : new ServerDOMMatrix(other as MatrixInit);
    return this.set6(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }

  preMultiplySelf(other?: MatrixInit | ServerDOMMatrix): this {
    const m = other instanceof ServerDOMMatrix ? other : new ServerDOMMatrix(other as MatrixInit);
    return this.set6(
      m.a * this.a + m.c * this.b,
      m.b * this.a + m.d * this.b,
      m.a * this.c + m.c * this.d,
      m.b * this.c + m.d * this.d,
      m.a * this.e + m.c * this.f + m.e,
      m.b * this.e + m.d * this.f + m.f,
    );
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf(new ServerDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  scaleSelf(sx = 1, sy = sx): this {
    return this.multiplySelf(new ServerDOMMatrix([sx, 0, 0, sy, 0, 0]));
  }

  invertSelf(): this {
    const determinant = this.a * this.d - this.b * this.c;
    // Tekil matris: tarayıcı davranışı tüm alanları NaN yapmaktır.
    if (!determinant) return this.set6(NaN, NaN, NaN, NaN, NaN, NaN);
    return this.set6(
      this.d / determinant,
      -this.b / determinant,
      -this.c / determinant,
      this.a / determinant,
      (this.c * this.f - this.d * this.e) / determinant,
      (this.b * this.e - this.a * this.f) / determinant,
    );
  }

  /** Değiştirmeyen sürümler kopya üzerinde çalışır. */
  private clone(): ServerDOMMatrix {
    return new ServerDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  multiply(other?: MatrixInit | ServerDOMMatrix) { return this.clone().multiplySelf(other); }
  translate(tx = 0, ty = 0) { return this.clone().translateSelf(tx, ty); }
  scale(sx = 1, sy = sx) { return this.clone().scaleSelf(sx, sy); }
  inverse() { return this.clone().invertSelf(); }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

/**
 * Çizim yolu kabuğu. Sunucuda hiçbir raster/vektör çıktı üretilmediği için
 * yalnızca çağrıları yutar; sessizce yanlış geometri döndürmemesi için de
 * hiçbir sorgu yöntemi (ör. `getBBox`) taklit edilmez.
 */
class ServerPath2D {
  addPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  closePath() {}
  rect() {}
  arc() {}
  ellipse() {}
}

/**
 * PDF.js içe aktarılmadan ÖNCE çağrılmalıdır: eksik globaller kurulur.
 * Var olan globaller (tarayıcı, canvas destekli Node) asla ezilmez.
 */
export function installPdfJsGlobals(): void {
  const host = globalThis as Record<string, unknown>;
  if (typeof host.DOMMatrix === "undefined") host.DOMMatrix = ServerDOMMatrix;
  if (typeof host.DOMMatrixReadOnly === "undefined") host.DOMMatrixReadOnly = ServerDOMMatrix;
  if (typeof host.Path2D === "undefined") host.Path2D = ServerPath2D;
}

/**
 * PDF.js çözümleyicisini AYNI iş parçacığında çalıştırır.
 *
 * PDF.js varsayılan olarak ayrı bir Web Worker açar; workerd'de `Worker`
 * yoktur, bu yüzden kütüphane "fake worker" yoluna düşer ve `workerSrc`
 * yolunu dinamik `import()` ile yüklemeye çalışır. Bu yol paketlenmiş sunucu
 * ortamında çözülemiyor ("The file does not exist at .vite/deps_rsc/
 * pdf.worker.mjs") ve analiz "Setting up fake worker failed" ile düşüyordu.
 *
 * PDF.js'in desteklediği kaçış kapısı `globalThis.pdfjsWorker`: bu alan
 * doluysa kütüphane hiçbir dosya yolu çözmez, doğrudan buradaki
 * `WorkerMessageHandler`'ı kullanır. Modül statik olarak içe aktarıldığı için
 * paketleyici onu normal bir bağımlılık gibi çözer.
 */
async function installPdfJsWorker(): Promise<void> {
  const host = globalThis as Record<string, unknown>;
  if (host.pdfjsWorker) return;
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  host.pdfjsWorker = workerModule;
}

/**
 * PDF.js'i sunucuda güvenle yükler. Modül yalnızca bir kez değerlendirilir;
 * globaller her çağrıda (idempotent) doğrulanır.
 */
export async function loadPdfJs() {
  installPdfJsGlobals();
  await installPdfJsWorker();
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}
