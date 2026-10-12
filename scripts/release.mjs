// Release script for the npm CLI package (@turinglambdaai/publy).
//
// Version semantics (keep these straight — they are three independent spaces):
//   - The ONLY user-facing npm version lives in packages/cli/package.json.
//     `@publy/core|shared|server` are private workspace packages, never published;
//     their version fields carry no external meaning.
//   - The Obsidian plugin has its own version space (manifest.json + versions.json,
//     released via GitHub Releases, not npm).
//   - A git tag `npm-v<version>` records which commit each npm version was built from.
//
// Usage: node scripts/release.mjs [--otp <code>] [--dry-run]
// Requires an npm account logged in (`npm login`) with 2FA.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(root, "packages", "cli");
const pkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8"));
const version = pkg.version;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const otpIndex = args.indexOf("--otp");
const otp = otpIndex !== -1 ? args[otpIndex + 1] : undefined;

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
}

// refuse to publish if the version already exists on npm
let published = false;
try {
  execSync(`npm view @turinglambdaai/publy@${version} version`, { stdio: "pipe" });
  published = true;
} catch {}
if (published) {
  console.error(`@turinglambdaai/publy@${version} is already published — bump the version first.`);
  process.exit(1);
}

let tagged = false;
try {
  execSync(`git rev-parse -q --verify refs/tags/npm-v${version}`, { stdio: "pipe" });
  tagged = true;
} catch {}
if (tagged) {
  console.error(`tag npm-v${version} already exists — bump the version first.`);
  process.exit(1);
}

if (execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim() !== "") {
  console.error("working tree is dirty — commit or stash first.");
  process.exit(1);
}

run("pnpm -r build");
run("pnpm -r test");

const otpArg = otp ? ` --otp ${otp}` : "";
run(`npm publish${dryRun ? " --dry-run" : ""}${otpArg}`, { cwd: cliDir });
if (dryRun) {
  console.log(`\ndry run complete — would publish @turinglambdaai/publy@${version} and tag npm-v${version}.`);
  process.exit(0);
}

run(`git tag npm-v${version}`);
run(`git push origin npm-v${version}`);
console.log(`\npublished @turinglambdaai/publy@${version}, tagged npm-v${version}.`);
console.log(`next: GitHub Release with notes (commit range since the previous npm-v* tag).`);
