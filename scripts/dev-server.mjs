// Cross-platform dev server using esbuild's JS API (context + serve).
// No shell expansion and no subprocess spawning, so it behaves the same on
// Unix and Windows (npm runs scripts via cmd.exe on Windows, where
// `${PORT:-8080}` and spawning the native esbuild binary would break).
//
//   npm run dev            → http://localhost:8080/app.html
//   PORT=8099 npm run dev  → http://localhost:8099/app.html
import { context } from 'esbuild';

const port = Number(process.env.PORT || 8080);

const ctx = await context({
  bundle: true,
  entryPoints: ['src/main.js'],
  outfile: 'dist/main.js',
  format: 'iife',
  logLevel: 'info',
});

const { port: actualPort } = await ctx.serve({
  servedir: 'dist',
  port,
});

console.log(`dev server: http://localhost:${actualPort}/app.html (Ctrl+C to stop)`);
