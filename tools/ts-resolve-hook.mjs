// Node'un yerleşik tip sıyırıcısı (--experimental-strip-types) uzantısız
// göreli içe aktarımları ("./types") çözemez; uygulama kodu ise bundler
// alışkanlığıyla uzantısız yazar. Bu kanca yalnızca test koşusunda, uzantısız
// göreli belirteçlere .ts/.tsx/.mts eklemeyi dener.
//
// Kullanım: node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs --test tools/*.test.ts
//
// Uyumluluk: `module.registerHooks` (eşzamanlı kanca) Node 22.15 ile geldi.
// package.json `engines` alanı 22.13'e izin verdiği için daha eski 22.x
// sürümlerinde aynı çözümleme, `module.register` ile yüklenen bir eşzamansız
// kanca üzerinden yapılır. İki yol da aynı kuralı uygular.
import * as nodeModule from "node:module";

const EXTENSIONS = [".ts", ".tsx", ".mts"];

const RESOLVER_SOURCE = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const EXTENSIONS = ${JSON.stringify(EXTENSIONS)};
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\\.[a-z0-9]+$/i.test(specifier);
  if (relative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
}
`;

if (typeof nodeModule.registerHooks === "function") {
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
      if (relative && !hasExtension && context.parentURL) {
        const base = new URL(specifier, context.parentURL);
        for (const extension of EXTENSIONS) {
          const candidate = new URL(`${base.href}${extension}`);
          if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(RESOLVER_SOURCE)}`, import.meta.url);
}
