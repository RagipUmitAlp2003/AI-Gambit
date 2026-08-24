import { readFile } from "node:fs/promises";
import path from "node:path";

const envExample = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
const keyLine = envExample.split(/\r?\n/).find((line) => line.startsWith("GEMINI_API_KEY="));
const value = keyLine?.slice("GEMINI_API_KEY=".length).trim();

if (!value || value === "your_api_key_here") {
  console.log("Repository safety check: PASS");
} else {
  console.error("Repository safety check: .env.example gerçek bir API anahtarı içeremez.");
  process.exitCode = 1;
}
