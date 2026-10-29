import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const get = (p) => fs.readFileSync(path.join(root, p), "utf8");
const cli = JSON.parse(get("packages/cli/package.json"));
assert.equal(cli.private, true, "CLI must not be published to npm Registry");
assert.ok(!fs.existsSync(path.join(root, "scripts/release.mjs")), "remove legacy npm publishing script");
for (const p of ["docs/index.html", "docs/guide.md", "docs/guide.zh-CN.md"]) {
  const content = get(p);
  assert.ok(!/npm i(?:nstall)? -g\s+@turinglambdaai\/publy/i.test(content), p + " still recommends retired npm install");
  assert.ok(!/www\.npmjs\.com\/package\/@turinglambdaai\/publy/i.test(content), p + " still links retired package");
}
assert.ok(fs.existsSync(path.join(root, "docs/distribution.md")), "document no-registry distribution");
console.log("PASS — npm Registry publishing retired; website and manuals do not advertise obsolete install");
