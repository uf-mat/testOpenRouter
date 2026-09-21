import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.js', 'app.js', ...['lib', 'public', 'test', 'scripts'].flatMap(dir => readdirSync(dir).filter(name => /\.m?js$/.test(name)).map(name => `${dir}/${name}`))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Sintaxis correcta: ${files.length} archivos JavaScript.`);
