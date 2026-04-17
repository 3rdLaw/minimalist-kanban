import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { builtinModules } from "module";
import process from "process";

const isProd = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "node:*",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: isProd ? false : "inline",
  treeShaking: true,
  minify: isProd,
  logLevel: "info",
  plugins: [
    esbuildSvelte({
      preprocess: sveltePreprocess(),
      compilerOptions: { css: "injected" },
    }),
  ],
});

if (isProd) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
