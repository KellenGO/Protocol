import { readdirSync, statSync } from 'node:fs';
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
const tests = collectTests(outputDirectory);
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });

process.exit(result.status ?? 1);
