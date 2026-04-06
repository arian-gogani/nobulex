import { describe, it, expect } from 'vitest';
import { bashCompletions, zshCompletions, fishCompletions } from './completions';

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------

const ALL_COMMANDS = [
  'init',
  'create',
  'verify',
  'evaluate',
  'inspect',
  'parse',
  'version',
  'help',
  'completions',
  'doctor',
  'diff',
];

const GLOBAL_FLAGS = ['--json', '--no-color', '--help', '--config'];

// ===========================================================================
// Bash completions
// ===========================================================================

describe('bashCompletions', () => {
  it('returns a non-empty string', () => {
    const result = bashCompletions();
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the complete command registration', () => {
    const result = bashCompletions();
    expect(result).toContain('complete -F _nobulex_completions nobulex');
  });

  it('includes the completion function name', () => {
    const result = bashCompletions();
    expect(result).toContain('_nobulex_completions');
  });

  it('includes compgen for word generation', () => {
    const result = bashCompletions();
    expect(result).toContain('compgen');
  });

  it('includes all commands', () => {
    const result = bashCompletions();
    for (const cmd of ALL_COMMANDS) {
      expect(result).toContain(cmd);
    }
  });

  it('includes global flags', () => {
    const result = bashCompletions();
    for (const flag of GLOBAL_FLAGS) {
      expect(result).toContain(flag);
    }
  });

  it('includes evaluate action suggestions', () => {
    const result = bashCompletions();
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('delete');
    expect(result).toContain('api.call');
  });

  it('includes completions shell suggestions including fish', () => {
    const result = bashCompletions();
    expect(result).toContain('bash');
    expect(result).toContain('zsh');
    expect(result).toContain('fish');
  });

  it('includes create-specific flags', () => {
    const result = bashCompletions();
    expect(result).toContain('--issuer');
    expect(result).toContain('--beneficiary');
    expect(result).toContain('--constraints');
  });

  it('starts with a comment header', () => {
    const result = bashCompletions();
    expect(result.startsWith('#')).toBe(true);
  });
});

// ===========================================================================
// Zsh completions
// ===========================================================================

describe('zshCompletions', () => {
  it('returns a non-empty string', () => {
    const result = zshCompletions();
    expect(result.length).toBeGreaterThan(0);
  });

  it('starts with #compdef directive', () => {
    const result = zshCompletions();
    expect(result).toContain('#compdef nobulex');
  });

  it('includes the _nobulex function', () => {
    const result = zshCompletions();
    expect(result).toContain('_nobulex');
  });

  it('includes _arguments for option parsing', () => {
    const result = zshCompletions();
    expect(result).toContain('_arguments');
  });

  it('includes _describe for command completion', () => {
    const result = zshCompletions();
    expect(result).toContain('_describe');
  });

  it('includes all commands', () => {
    const result = zshCompletions();
    for (const cmd of ALL_COMMANDS) {
      expect(result).toContain(cmd);
    }
  });

  it('includes global flags', () => {
    const result = zshCompletions();
    expect(result).toContain('--json');
    expect(result).toContain('--no-color');
    expect(result).toContain('--help');
    expect(result).toContain('--config');
  });

  it('includes command descriptions', () => {
    const result = zshCompletions();
    expect(result).toContain('Generate an Ed25519 key pair');
    expect(result).toContain('Verify a covenant document');
    expect(result).toContain('Check Nobulex installation health');
  });

  it('includes evaluate action suggestions', () => {
    const result = zshCompletions();
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('delete');
    expect(result).toContain('api.call');
  });

  it('includes completions shell suggestions including fish', () => {
    const result = zshCompletions();
    expect(result).toContain('bash');
    expect(result).toContain('zsh');
    expect(result).toContain('fish');
  });

  it('includes create-specific flags', () => {
    const result = zshCompletions();
    expect(result).toContain('--issuer');
    expect(result).toContain('--beneficiary');
    expect(result).toContain('--constraints');
  });
});

// ===========================================================================
// Fish completions
// ===========================================================================

describe('fishCompletions', () => {
  it('returns a non-empty string', () => {
    const result = fishCompletions();
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses fish complete command', () => {
    const result = fishCompletions();
    expect(result).toContain('complete -c nobulex');
  });

  it('includes all commands', () => {
    const result = fishCompletions();
    for (const cmd of ALL_COMMANDS) {
      expect(result).toContain(cmd);
    }
  });

  it('includes global flags', () => {
    const result = fishCompletions();
    expect(result).toContain('-l json');
    expect(result).toContain('-l no-color');
    expect(result).toContain('-l help');
    expect(result).toContain('-l config');
  });

  it('includes command descriptions', () => {
    const result = fishCompletions();
    expect(result).toContain('Generate an Ed25519 key pair');
    expect(result).toContain('Verify a covenant document');
    expect(result).toContain('Check Nobulex installation health');
  });

  it('includes evaluate action suggestions', () => {
    const result = fishCompletions();
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('delete');
    expect(result).toContain('api.call');
  });

  it('includes completions shell suggestions including fish', () => {
    const result = fishCompletions();
    expect(result).toContain('bash');
    expect(result).toContain('zsh');
    expect(result).toContain('fish');
  });

  it('includes create-specific flags', () => {
    const result = fishCompletions();
    // Fish uses -l (long) syntax, not --flag
    expect(result).toContain('-l issuer');
    expect(result).toContain('-l beneficiary');
    expect(result).toContain('-l constraints');
  });

  it('disables default file completions', () => {
    const result = fishCompletions();
    expect(result).toContain('complete -c nobulex -f');
  });

  it('uses __fish_seen_subcommand_from for context', () => {
    const result = fishCompletions();
    expect(result).toContain('__fish_seen_subcommand_from');
  });

  it('starts with a comment header', () => {
    const result = fishCompletions();
    expect(result.startsWith('#')).toBe(true);
  });
});
