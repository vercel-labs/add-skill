import { execSync } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(import.meta.dirname, 'cli.ts');
const TSX_PATH = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function stripLogo(str: string): string {
  return str
    .split('\n')
    .filter((line) => !line.includes('███') && !line.includes('╔') && !line.includes('╚'))
    .join('\n')
    .replace(/^\n+/, '');
}

export function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const output = execSync(`${TSX_PATH} ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : undefined,
    });
    return { stdout: stripAnsi(output), stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: stripAnsi(error.stdout || ''),
      stderr: stripAnsi(error.stderr || ''),
      exitCode: error.status || 1,
    };
  }
}

export function runCliOutput(args: string[], cwd?: string): string {
  const result = runCli(args, cwd);
  return result.stdout || result.stderr;
}
