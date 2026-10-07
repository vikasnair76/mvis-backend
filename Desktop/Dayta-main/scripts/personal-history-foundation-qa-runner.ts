import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(
    process.cwd(), ".dayta-personal-history-qa-"));
  const output = path.join(directory, "personal-history-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [path.join(process.cwd(), "scripts",
        "personal-history-foundation-qa.ts")],
      outfile: output, bundle: true, packages: "external", format: "esm",
      platform: "node", target: "node22",
      plugins: [{
        name: "mock-dayta-firebase",
        setup(buildApi) {
          buildApi.onResolve({filter: /^\.\/firebase$/}, () => ({
            path: "dayta-firebase", namespace: "qa-mock",
          }));
          buildApi.onLoad({filter: /.*/, namespace: "qa-mock"}, () => ({
            contents: "export const db = {};",
          }));
        },
      }],
    });
    await import(pathToFileURL(output).href);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
