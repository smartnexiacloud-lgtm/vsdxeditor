// Cross-platform dev server: esbuild's CLI is invoked with the port computed
// here, because `${PORT:-8080}` shell expansion in npm scripts only works on
// Unix (npm runs scripts via cmd.exe on Windows).
//
//   PORT=8099 npm run dev   → serves http://localhost:8099
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuildBin = require.resolve('esbuild/bin/esbuild');
const port = process.env.PORT || '8080';

const child = spawn(esbuildBin, [
  'src/main.js',
  '--bundle',
  '--outfile=dist/main.js',
  '--format=iife',
  '--servedir=dist',
  `--serve=${port}`,
], { stdio: 'inherit' });

child.on('exit', (code) => process.exit(code ?? 0));
