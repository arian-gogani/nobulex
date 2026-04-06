/**
 * @nobulex/cli shell completion generators.
 *
 * Generates completion scripts for bash, zsh, and fish shells.
 * Each generator produces a self-contained script that can be
 * sourced or piped to the appropriate completions directory.
 *
 * @packageDocumentation
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const COMMANDS = [
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
] as const;

const GLOBAL_FLAGS = ['--json', '--no-color', '--help', '--config'] as const;

const EVALUATE_ACTIONS = ['read', 'write', 'delete', 'api.call'] as const;

const SHELLS = ['bash', 'zsh', 'fish'] as const;

// ─── Bash ─────────────────────────────────────────────────────────────────────

/**
 * Generate bash completion script for the nobulex CLI.
 *
 * The script registers a `_nobulex_completions` function via `complete -F`.
 * It autocompletes commands, flags, evaluate actions, and shell names.
 *
 * @returns A bash completion script as a string.
 *
 * @example
 * ```bash
 * nobulex completions bash > /etc/bash_completion.d/nobulex
 * source /etc/bash_completion.d/nobulex
 * ```
 */
export function bashCompletions(): string {
  const commandList = COMMANDS.join(' ');
  const globalFlagList = GLOBAL_FLAGS.join(' ');
  const evaluateActionList = EVALUATE_ACTIONS.join(' ');
  const shellList = SHELLS.join(' ');

  return `# Bash completion for nobulex CLI
# Source this file or copy to /etc/bash_completion.d/nobulex

_nobulex_completions() {
    local cur prev commands global_flags
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="${commandList}"
    global_flags="${globalFlagList}"

    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
        return 0
    fi

    case "\${COMP_WORDS[1]}" in
        create)
            local create_flags="--issuer --beneficiary --constraints --json --help --config"
            COMPREPLY=( $(compgen -W "\${create_flags}" -- "\${cur}") )
            ;;
        evaluate)
            if [[ \${COMP_CWORD} -eq 3 ]]; then
                local actions="${evaluateActionList}"
                COMPREPLY=( $(compgen -W "\${actions}" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -W "\${global_flags}" -- "\${cur}") )
            fi
            ;;
        completions)
            COMPREPLY=( $(compgen -W "${shellList}" -- "\${cur}") )
            ;;
        *)
            COMPREPLY=( $(compgen -W "\${global_flags}" -- "\${cur}") )
            ;;
    esac
    return 0
}

complete -F _nobulex_completions nobulex`;
}

// ─── Zsh ──────────────────────────────────────────────────────────────────────

/**
 * Generate zsh completion script for the nobulex CLI.
 *
 * The script registers a `_nobulex` completion function using zsh's
 * `_arguments` and `_describe` builtins for rich contextual completions.
 *
 * @returns A zsh completion script as a string.
 *
 * @example
 * ```bash
 * nobulex completions zsh > ~/.zsh/completions/_nobulex
 * ```
 */
export function zshCompletions(): string {
  return `#compdef nobulex
# Zsh completion for nobulex CLI
# Copy to a directory in your $fpath (e.g. ~/.zsh/completions/_nobulex)

_nobulex() {
    local -a commands
    commands=(
        'init:Generate an Ed25519 key pair and config file'
        'create:Create and sign a covenant document'
        'verify:Verify a covenant document'
        'evaluate:Evaluate an action against a covenant'
        'inspect:Pretty-print covenant details'
        'parse:Parse CCL and output AST'
        'completions:Generate shell completion script'
        'doctor:Check Nobulex installation health'
        'diff:Show differences between two covenant documents'
        'version:Print version information'
        'help:Show help message'
    )

    _arguments -C \\
        '--json[Machine-readable JSON output]' \\
        '--no-color[Disable colored output]' \\
        '--help[Show help]' \\
        '--config[Path to config file]' \\
        '1:command:->command' \\
        '*::arg:->args'

    case $state in
        command)
            _describe 'nobulex command' commands
            ;;
        args)
            case $words[1] in
                create)
                    _arguments \\
                        '--issuer[Issuer identifier]:id:' \\
                        '--beneficiary[Beneficiary identifier]:id:' \\
                        '--constraints[CCL constraint string]:ccl:' \\
                        '--json[Output raw JSON]' \\
                        '--config[Path to config file]:file:_files'
                    ;;
                evaluate)
                    _arguments \\
                        '1:covenant-json:' \\
                        '2:action:(read write delete api.call)' \\
                        '3:resource:' \\
                        '--json[Output raw JSON]'
                    ;;
                completions)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
            esac
            ;;
    esac
}

_nobulex "$@"`;
}

// ─── Fish ─────────────────────────────────────────────────────────────────────

/**
 * Generate fish completion script for the nobulex CLI.
 *
 * The script uses fish's `complete` builtin to register completions
 * for commands, flags, and context-specific arguments.
 *
 * @returns A fish completion script as a string.
 *
 * @example
 * ```fish
 * nobulex completions fish > ~/.config/fish/completions/nobulex.fish
 * ```
 */
export function fishCompletions(): string {
  const commandDescriptions: [string, string][] = [
    ['init', 'Generate an Ed25519 key pair and config file'],
    ['create', 'Create and sign a covenant document'],
    ['verify', 'Verify a covenant document'],
    ['evaluate', 'Evaluate an action against a covenant'],
    ['inspect', 'Pretty-print covenant details'],
    ['parse', 'Parse CCL and output AST'],
    ['completions', 'Generate shell completion script'],
    ['doctor', 'Check Nobulex installation health'],
    ['diff', 'Show differences between two covenant documents'],
    ['version', 'Print version information'],
    ['help', 'Show help message'],
  ];

  const lines: string[] = [
    '# Fish completion for nobulex CLI',
    '# Copy to ~/.config/fish/completions/nobulex.fish',
    '',
    '# Disable file completions by default',
    'complete -c nobulex -f',
    '',
    '# Commands',
  ];

  for (const [cmd, desc] of commandDescriptions) {
    lines.push(
      `complete -c nobulex -n "not __fish_seen_subcommand_from ${COMMANDS.join(' ')}" -a "${cmd}" -d "${desc}"`,
    );
  }

  lines.push('');
  lines.push('# Global flags');
  lines.push('complete -c nobulex -l json -d "Machine-readable JSON output"');
  lines.push('complete -c nobulex -l no-color -d "Disable colored output"');
  lines.push('complete -c nobulex -l help -d "Show help"');
  lines.push('complete -c nobulex -l config -d "Path to config file"');

  lines.push('');
  lines.push('# create flags');
  lines.push(
    'complete -c nobulex -n "__fish_seen_subcommand_from create" -l issuer -d "Issuer identifier"',
  );
  lines.push(
    'complete -c nobulex -n "__fish_seen_subcommand_from create" -l beneficiary -d "Beneficiary identifier"',
  );
  lines.push(
    'complete -c nobulex -n "__fish_seen_subcommand_from create" -l constraints -d "CCL constraint string"',
  );

  lines.push('');
  lines.push('# evaluate action suggestions');
  for (const action of EVALUATE_ACTIONS) {
    lines.push(
      `complete -c nobulex -n "__fish_seen_subcommand_from evaluate" -a "${action}" -d "Action: ${action}"`,
    );
  }

  lines.push('');
  lines.push('# completions shell suggestions');
  for (const shell of SHELLS) {
    lines.push(
      `complete -c nobulex -n "__fish_seen_subcommand_from completions" -a "${shell}" -d "${shell} shell"`,
    );
  }

  return lines.join('\n');
}
