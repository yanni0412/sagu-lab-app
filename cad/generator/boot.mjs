import { createRequire } from "module"; import path from "path";
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = path.join(path.dirname(new URL(import.meta.url).pathname), "node_modules/replicad-opencascadejs/src");
await import("./build.mjs");
