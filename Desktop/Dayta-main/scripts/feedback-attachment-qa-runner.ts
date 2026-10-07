import {mkdtemp, readFile, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(process.cwd(),
    ".dayta-feedback-attachment-qa-"));
  const outfile = path.join(directory, "qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      stdin: {
        contents: await readFile(path.join(process.cwd(), "scripts",
          "feedback-attachment-qa.ts"), "utf8"),
        sourcefile: "feedback-attachment-qa.ts",
        resolveDir: path.join(process.cwd(), "scripts"),
        loader: "ts",
      },
      outfile, bundle: true, packages: "external", format: "esm",
      platform: "node", target: "node22",
      plugins: [{
        name: "mock-native-dependencies",
        setup(api) {
          api.onResolve({filter: /^\.\.\/services\/feedback$/}, () =>
            ({path: "feedback", namespace: "qa-source"}));
          api.onResolve({
            filter: /^\.\.\/services\/feedbackAttachments$/,
          }, () => ({path: "feedbackAttachments", namespace: "qa-source"}));
          api.onResolve({filter: /^\.\/feedback$/}, () =>
            ({path: "feedback", namespace: "qa-source"}));
          api.onLoad({filter: /^feedback$/, namespace: "qa-source"},
            async () => ({contents: await readFile(path.join(process.cwd(),
              "services", "feedback.ts"), "utf8"), loader: "ts",
            resolveDir: path.join(process.cwd(), "services")}));
          api.onLoad({filter: /^feedbackAttachments$/,
            namespace: "qa-source"}, async () => ({
            contents: await readFile(path.join(process.cwd(), "services",
              "feedbackAttachments.ts"), "utf8"), loader: "ts",
            resolveDir: path.join(process.cwd(), "services"),
          }));
          api.onResolve({filter: /^expo-crypto$/}, () =>
            ({path: "crypto", namespace: "qa"}));
          api.onLoad({filter: /^crypto$/, namespace: "qa"}, () => ({
            contents: "export const randomUUID=()=>globalThis.crypto.randomUUID();",
          }));
          api.onResolve({filter: /^firebase\/storage$/}, () =>
            ({path: "storage", namespace: "qa"}));
          api.onLoad({filter: /^storage$/, namespace: "qa"}, () => ({
            contents: "const noop=()=>({}); export const deleteObject=noop," +
              "ref=noop,uploadBytesResumable=noop;",
          }));
          api.onResolve({filter: /^\.\/firebase$/}, () =>
            ({path: "firebase", namespace: "qa"}));
          api.onLoad({filter: /^firebase$/, namespace: "qa"}, () => ({
            contents: "export const storage={};",
          }));
        },
      }],
    });
    await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
