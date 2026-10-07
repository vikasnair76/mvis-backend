import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(
    process.cwd(), ".dayta-personal-history-query-qa-"));
  const output = path.join(directory, "personal-history-query-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [path.join(process.cwd(), "scripts",
        "personal-history-query-qa.ts")],
      outfile: output,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "personal-history-emulator-firebase",
        setup(buildApi) {
          buildApi.onResolve({filter: /^\.{1,2}[\\/].*firebase$/}, () => ({
            path: "dayta-query-firebase",
            namespace: "qa-firebase",
          }));
          buildApi.onLoad({filter: /.*/, namespace: "qa-firebase"}, () => ({
            resolveDir: process.cwd(),
            contents: `
              import {readFileSync} from "node:fs";
              import {initializeTestEnvironment} from
                "@firebase/rules-unit-testing";
              const [host, portText] =
                process.env.FIRESTORE_EMULATOR_HOST.split(":");
              export const qaTestEnv = await initializeTestEnvironment({
                projectId: "dayta---goalsettingapp",
                firestore: {
                  host,
                  port: Number(portText),
                  rules: readFileSync("firestore.rules", "utf8")
                }
              });
              export const db =
                qaTestEnv.authenticatedContext("owner").firestore();
            `,
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
