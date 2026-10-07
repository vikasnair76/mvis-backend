import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(process.cwd(), ".dayta-shared-media-qa-"));
  const outfile = path.join(directory, "shared-media-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      stdin: {
        contents: await readFile(path.join(process.cwd(), "scripts", "shared-media-infrastructure-qa.ts"), "utf8"),
        sourcefile: "shared-media-infrastructure-qa.ts",
        resolveDir: path.join(process.cwd(), "scripts"),
        loader: "ts",
      },
      outfile,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "mock-native-dependencies",
        setup(api) {
          api.onResolve({ filter: /^\.\.\/services\/mediaAttachments$/ }, () => ({ path: "mediaAttachments", namespace: "qa-source" }));
          api.onResolve({ filter: /^\.\.\/services\/mediaUploadSessions$/ }, () => ({ path: "mediaUploadSessions", namespace: "qa-source" }));
          api.onResolve({ filter: /^\.\/mediaAttachments$/ }, () => ({ path: "mediaAttachments", namespace: "qa-source" }));
          api.onLoad({ filter: /^mediaAttachments$/, namespace: "qa-source" }, async () => ({
            contents: await readFile(path.join(process.cwd(), "services", "mediaAttachments.ts"), "utf8"),
            loader: "ts",
            resolveDir: path.join(process.cwd(), "services"),
          }));
          api.onLoad({ filter: /^mediaUploadSessions$/, namespace: "qa-source" }, async () => ({
            contents: await readFile(path.join(process.cwd(), "services", "mediaUploadSessions.ts"), "utf8"),
            loader: "ts",
            resolveDir: path.join(process.cwd(), "services"),
          }));
          api.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: "crypto", namespace: "qa" }));
          api.onLoad({ filter: /^crypto$/, namespace: "qa" }, () => ({ contents: "export const randomUUID = () => globalThis.crypto.randomUUID();" }));
          api.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, (args) => ({ path: args.path, namespace: "qa" }));
          api.onLoad({ filter: /^firebase\/(firestore|storage)$/, namespace: "qa" }, () => ({
            contents: "const noop = () => ({}); export const deleteObject=noop,getDownloadURL=noop,ref=noop,uploadBytesResumable=noop,doc=noop,getDoc=noop,serverTimestamp=noop,setDoc=noop,updateDoc=noop;",
          }));
          api.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase", namespace: "qa" }));
          api.onLoad({ filter: /^firebase$/, namespace: "qa" }, () => ({ contents: "export const db = {}; export const storage = {};" }));
        },
      }],
    });
    await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
