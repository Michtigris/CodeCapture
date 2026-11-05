import fs from "fs";
import path from "path";

/** Sur Webstrator, Next renvoie parfois 404 pour /_next/static/css/*.css.
 *  Un lien physique httpdocs/_next/static → .next/static laisse nginx servir les assets. */
const root = process.cwd();
const target = path.join(root, ".next", "static");
const linkDir = path.join(root, "_next");
const link = path.join(linkDir, "static");

if (!fs.existsSync(target)) {
  console.warn("ensure-next-static: .next/static absent, skip");
  process.exit(0);
}

fs.mkdirSync(linkDir, { recursive: true });
try {
  fs.lstatSync(link);
  fs.rmSync(link, { recursive: true, force: true });
} catch {
  /* pas encore de lien */
}

try {
  fs.symlinkSync(target, link, "dir");
  console.log("ensure-next-static: _next/static → .next/static");
} catch (error) {
  console.warn("ensure-next-static: symlink impossible:", error instanceof Error ? error.message : error);
  process.exitCode = 0;
}
