// Node'un yerleşik tip sıyırıcısı (--experimental-strip-types) uzantısız
// göreli içe aktarımları ("./types") çözemez; uygulama kodu ise bundler
// alışkanlığıyla uzantısız yazar. Bu kanca yalnızca test koşusunda, uzantısız
// göreli belirteçlere .ts/.tsx/.mts eklemeyi dener.
//
// Kullanım: node --experimental-strip-types --import ./tools/ts-resolve-hook.mjs --test tools/*.test.ts
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mts"];

registerHooks({
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
