import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const production = process.argv.includes('--production');

// Copy kuromoji dictionary files to data/kuromoji-dict so the bundled extension works standalone
const srcDictDir = path.resolve('node_modules/kuromoji/dict');
const destDictDir = path.resolve('data/kuromoji-dict');
if (fs.existsSync(srcDictDir)) {
  fs.mkdirSync(destDictDir, { recursive: true });
  for (const file of fs.readdirSync(srcDictDir)) {
    const srcFile = path.join(srcDictDir, file);
    const destFile = path.join(destDictDir, file);
    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  }
}

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'info'
});
