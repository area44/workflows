import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';
import { runAutofix } from './autofix';

vi.mock('fs');
vi.mock('child_process');

describe('autofix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'autofix.js'];
  });

  it('should skip if package.json does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'log');

    runAutofix();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No package.json found'));
  });

  it('should run "check" script if it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      scripts: { check: 'tsc' }
    }));

    runAutofix();

    expect(execSync).toHaveBeenCalledWith('npm run check', expect.any(Object));
  });

  it('should run "format" and "lint" scripts if they exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      scripts: { format: 'prettier', lint: 'eslint' }
    }));

    runAutofix();

    expect(execSync).toHaveBeenCalledWith('npm run format', expect.any(Object));
    expect(execSync).toHaveBeenCalledWith('npm run lint', expect.any(Object));
  });

  it('should use specified package manager from arguments', () => {
    process.argv = ['node', 'autofix.js', 'pnpm'];
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      scripts: { check: 'tsc' }
    }));

    runAutofix();

    expect(execSync).toHaveBeenCalledWith('pnpm run check', expect.any(Object));
  });
});
