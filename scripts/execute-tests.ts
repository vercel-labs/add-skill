#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type RunOptions = {
  rootDir: string;
  testsDir: string;
  filter?: RegExp;
  listOnly: boolean;
};

function parseArgs(argv: string[], rootDir: string): RunOptions {
  const testsDir = path.join(rootDir, 'tests');
  let filter: RegExp | undefined;
  let listOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list' || arg === '-l') {
      listOnly = true;
      continue;
    }
    if (arg === '--filter' || arg === '-f') {
      const pattern = argv[i + 1];
      if (!pattern) throw new Error('Missing value for --filter');
      filter = new RegExp(pattern);
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/execute-tests.ts [options]\n\nOptions:\n  -l, --list              List discovered test files and exit\n  -f, --filter <regex>    Only run tests whose path matches regex\n  -h, --help              Show help\n`
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { rootDir, testsDir, filter, listOnly };
}

async function findTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTestFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function runOneTest(rootDir: string, testFile: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn('node', [testFile], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '..');
  const opts = parseArgs(process.argv.slice(2), rootDir);

  let testFiles: string[];
  try {
    testFiles = await findTestFiles(opts.testsDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.exit(1);
  }

  if (opts.filter) {
    testFiles = testFiles.filter((f) => opts.filter!.test(f));
  }

  if (testFiles.length === 0) {
    process.exit(1);
  }

  if (opts.listOnly) {
    for (const file of testFiles) console.log(path.relative(opts.rootDir, file));
    return;
  }

  let failed = 0;
  for (const testFile of testFiles) {
    console.log(`\n— Running ${path.relative(opts.rootDir, testFile)} —`);
    const exitCode = await runOneTest(opts.rootDir, testFile);
    if (exitCode !== 0) failed++;
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`\nAll ${testFiles.length} test file(s) passed.`);
}

await main();
