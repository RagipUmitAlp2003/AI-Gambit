import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const envExample = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
const keyLine = envExample.split(/\r?\n/).find((line) => line.startsWith("GEMINI_API_KEY="));
const value = keyLine?.slice("GEMINI_API_KEY=".length).trim();

if (value && value !== "your_api_key_here") {
  console.error("Repository safety check: .env.example gerçek bir API anahtarı içeremez.");
  process.exitCode = 1;
} else {
  // Yalnızca o an commit edilebilecek (Git tarafından izlenen) dosyalar
  // taranır. Yerel .env.local zaten Git dışında kalır ve içeriği loglanmaz.
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  const secretPattern = /(?:AIza[0-9A-Za-z_-]{25,}|AQ\.[0-9A-Za-z_-]{20,})/;
  const unsafe = [];

  for (const file of files) {
    let bytes;
    try { bytes = await readFile(path.join(process.cwd(), file)); }
    catch { continue; }
    if (bytes.includes(0)) continue;
    if (secretPattern.test(bytes.toString("utf8"))) unsafe.push(file);
  }

  if (unsafe.length) {
    console.error(`Repository safety check: ${unsafe.length} izlenen dosyada olası API anahtarı bulundu. Anahtar değeri güvenlik nedeniyle gösterilmedi.`);
    for (const file of unsafe) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    console.log("Repository safety check: PASS");
  }
}
