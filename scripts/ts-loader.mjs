// Lets plain `node --import ./scripts/ts-loader.mjs <script>` run our TypeScript sources: resolves the
// "@/..." alias to src/ and adds ".ts" to extensionless relative imports. Types are stripped by Node ≥ 23.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC = path.join(process.cwd(), "src");
const withTs = (p) => (existsSync(p) ? p : existsSync(p + ".ts") ? p + ".ts" : existsSync(p + ".tsx") ? p + ".tsx" : p);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(pathToFileURL(withTs(path.join(SRC, specifier.slice(2)))).href, context);
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parent = context.parentURL ? path.dirname(new URL(context.parentURL).pathname) : process.cwd();
      const abs = withTs(path.resolve(parent, specifier));
      if (abs.endsWith(".ts") || abs.endsWith(".tsx")) return next(pathToFileURL(abs).href, context);
    }
    return next(specifier, context);
  },
});
