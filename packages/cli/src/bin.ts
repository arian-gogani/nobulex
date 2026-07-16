#!/usr/bin/env node
/*
 * Binary entry point. The only place in the package that talks to the real
 * process, everything below is a pure function.
 */
import { run } from './index.js';

const result = run(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
