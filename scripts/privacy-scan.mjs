import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ignoredDirectories = new Set([".git", ".tools", ".cache", "dist", "node_modules", "output"]);
const scannedExtensions = new Set([".cmd", ".example", ".json", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx", ".yml", ".yaml"]);
const findings = [];

const patterns = [
  { name: "local Windows user path", regex: /C:\\Users\\[^\\\r\n]+/i },
  { name: "personal Gmail address", regex: /[A-Z0-9._%+-]+@gmail\.com/i },
  { name: "hard-coded secret literal", regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{12,}["']/i }
];

await scanDirectory(process.cwd());

if (findings.length > 0) {
  console.error("Privacy scan found potential PII or secret exposure:");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.name}`);
  }
  process.exit(1);
}

console.log("Privacy scan passed.");

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await scanDirectory(join(directory, entry.name));
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const filePath = join(directory, entry.name);
    if (!shouldScan(filePath)) {
      continue;
    }

    const file = await stat(filePath);
    if (file.size > 1_000_000) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const displayPath = relative(process.cwd(), filePath);
    if (displayPath === "scripts\\privacy-scan.mjs" || displayPath === "scripts/privacy-scan.mjs") {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        findings.push({ file: displayPath, name: pattern.name });
      }
    }
  }
}

function shouldScan(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.endsWith(".env.example")) {
    return true;
  }
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 && scannedExtensions.has(normalized.slice(dotIndex));
}
