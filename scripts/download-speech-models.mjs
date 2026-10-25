import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const models = {
  tiny: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  },
  base: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  },
};

const requested = process.argv.slice(2);
if (requested.includes("--help") || requested.includes("-h")) {
  console.log("Usage: npm run speech:models [-- tiny|base]");
  console.log("Downloads both models by default. Model files are saved under public/speech/.");
  process.exit(0);
}
const names = requested.length ? requested : Object.keys(models);
for (const name of names) {
  if (!(name in models)) throw new Error(`Unknown model '${name}'. Choose tiny or base.`);
}

const destinationDirectory = path.join(process.cwd(), "public", "speech");
await mkdir(destinationDirectory, { recursive: true });

for (const name of names) {
  const model = models[name];
  const destination = path.join(destinationDirectory, `ggml-${name}.bin`);
  const temporary = `${destination}.download`;

  try {
    await stat(destination);
    const currentHash = createHash("sha256").update(await readFile(destination)).digest("hex");
    if (currentHash === model.sha256) {
      console.log(`${name}: already downloaded and checksum verified`);
      continue;
    }
    console.log(`${name}: existing file has the wrong checksum; downloading a fresh copy`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    console.log(`${name}: downloading from the official whisper.cpp model repository`);
  }

  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Could not download ${name}: HTTP ${response.status}`);

  const hash = createHash("sha256");
  const hashAndPassThrough = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), hashAndPassThrough, createWriteStream(temporary));
    const actualHash = hash.digest("hex");
    if (actualHash !== model.sha256) throw new Error(`Checksum mismatch for ${name}: expected ${model.sha256}, received ${actualHash}`);
    await rename(temporary, destination);
    console.log(`${name}: downloaded and checksum verified`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
