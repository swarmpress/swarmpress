import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Playwright runs under Node; the fixtures are built with Bun.build, so shell out to Bun. */
export default function globalSetup(): void {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bun = process.env.BUN ?? "bun";
  execFileSync(bun, ["test/build-fixtures.ts", "--browser"], { cwd: pkg, stdio: "inherit" });
}
