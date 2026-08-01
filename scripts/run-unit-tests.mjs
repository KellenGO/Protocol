import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTests(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? collectTests(path) : [path];
    })
    .filter((path) => path.endsWith('.test.js'));
}

const outputDirectory = resolve('.unit-tests');
rmSync(outputDirectory, { recursive: true, force: true });

const compiler = resolve('node_modules/typescript/lib/tsc.js');
const compilation = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.unit.json'], {
  stdio: 'inherit',
});
if (compilation.status !== 0) {
  process.exit(compilation.status ?? 1);
}

const tests = collectTests(outputDirectory);
if (tests.length === 0) {
  console.error('Unit test compilation produced zero *.test.js files.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });

process.exit(result.status ?? 1);
