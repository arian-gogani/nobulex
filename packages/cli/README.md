# @nobulex/cli

Command-line tool to scaffold, verify, inspect, and report on Nobulex
covenant action logs. Verify the tamper-evidence of an agent's audit trail
from your terminal, with no code.

## Install

```bash
npm install -g @nobulex/cli
```

## Commands

```
nobulex <command> [args]

  init [path]                     Scaffold a new covenant project (defaults to .)
  verify <log-file> [--json]      Verify the hash-chain integrity of a log
  inspect <log-file> [--json]     Print a human-readable timeline
  report <log-file> --framework <name> [--text]
                                  Compliance report
                                  (frameworks: eu-ai-act-article-12,
                                   colorado-ai-act, soc2, iso-42001)
  help                            Show help
  version                         Print CLI version
```

## Examples

```bash
nobulex init ./my-agent
nobulex verify ./action-log.json
nobulex inspect ./action-log.json
nobulex report ./action-log.json --framework eu-ai-act-article-12
```

`verify` checks the Ed25519 signatures and the SHA-256 hash chain. If any
entry was altered, it fails. That is the guarantee: an auditor can confirm an
agent's log is intact without trusting whoever produced it.

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) · [nobulex.com](https://nobulex.com)
