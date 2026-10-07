import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(
    process.cwd(), ".dayta-group-history-static-qa-"));
  const output = path.join(directory, "group-history-static-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [path.join(process.cwd(), "scripts",
        "group-history-query-aggregation-qa.ts").replaceAll("\\", "/")],
      outfile: output,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "group-history-static-firebase",
        setup(buildApi) {
          buildApi.onResolve({filter: /^\.{1,2}[\\/].*firebase$/}, () => ({
            path: "dayta-static-firebase",
            namespace: "qa-firebase",
          }));
          buildApi.onLoad({filter: /.*/, namespace: "qa-firebase"}, () => ({
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
