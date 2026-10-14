// Runs after `vite build`: writes a Brotli (.br) and a gzip (.gz) copy next to every text file in
// dist/, so the API (src/http/spa.ts, `precompressed`) can serve them without compressing on each
// request. Cloud Run does not compress, and the 1 vCPU it has is better spent elsewhere.
// A copy is kept only when it is smaller than the original.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const compressible = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.ttf']);
const minBytes = 1024;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

let total = 0;
let brotli = 0;
for (const path of files(root)) {
  if (!compressible.has(extname(path)) || statSync(path).size < minBytes) continue;
  const source = readFileSync(path);
  const br = brotliCompressSync(source, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
  });
  const gz = gzipSync(source, { level: 9 });
  if (br.length < source.length) writeFileSync(`${path}.br`, br);
  if (gz.length < source.length) writeFileSync(`${path}.gz`, gz);
  total += source.length;
  brotli += Math.min(br.length, source.length);
}
console.log(`precompressed ${root}: ${(total / 1024).toFixed(0)} KB -> ${(brotli / 1024).toFixed(0)} KB (brotli)`);
