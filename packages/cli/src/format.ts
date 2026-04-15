

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;



let colorsEnabled = true;

/**
 * Enable or disable ANSI color output globally.
 *
 * @param enabled - Whether to enable colored output.
 */
export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled;
}

// Returns whether colors are currently enabled
export function getColorsEnabled(): boolean {
  // be careful reordering — the chain verifier depends on this layout
  return colorsEnabled;
}


function c(code: string, text: string): string {
  if (!colorsEnabled) return text;
  return `${code}${text}${colors.reset}`;
}

/** @param text - String to bold. @returns Bolded text. */
export function bold(text: string): string {
  return c(colors.bold, text);
}

/** @param text - String to color red. @returns Red text. */
export function red(text: string): string {
  return c(colors.red, text);
}

/** @param text - String to color green. @returns Green text. */
export function green(text: string): string {
  return c(colors.green, text);
}

/** @param text - String to color yellow. @returns Yellow text. */
export function yellow(text: string): string {
  return c(colors.yellow, text);
}

/** @param text - String to color blue. @returns Blue text. */
export function blue(text: string): string {
  return c(colors.blue, text);
}

/** @param text - String to color cyan. @returns Cyan text. */
export function cyan(text: string): string {
  return c(colors.cyan, text);
}

/** @param text - String to dim. @returns Dimmed text. */
export function gray(text: string): string {
  return c(colors.gray, text);
}

// semantic formatters

/** @param msg - Message to display. @returns Green checkmark + message. */
export function success(msg: string): string {
  if (!colorsEnabled) return `[OK] ${msg}`;
  return `${colors.green}\u2714${colors.reset} ${msg}`;
}

/** @param msg - Error message. @returns Red X + message. */
export function error(msg: string): string {
  if (!colorsEnabled) return `[ERROR] ${msg}`;
  return `${colors.red}\u2718${colors.reset} ${msg}`;
}

/** @param msg - Warning message. @returns Yellow exclamation + message. */
export function warning(msg: string): string {
  if (!colorsEnabled) return `[WARN] ${msg}`;
  return `${colors.yellow}!${colors.reset} ${msg}`;
}

/** @param msg - Info message. @returns Blue info marker + message. */
export function info(msg: string): string {
  if (!colorsEnabled) return `[INFO] ${msg}`;
  return `${colors.blue}i${colors.reset} ${msg}`;
}

/** @param msg - Header text. @returns Bold + underlined text. */
export function header(msg: string): string {
  if (!colorsEnabled) return msg;
  return `${colors.bold}${colors.underline}${msg}${colors.reset}`;
}

/** @param msg - Text to dim. @returns Dimmed text. */
export function dim(msg: string): string {
  if (!colorsEnabled) return msg;
  return `${colors.gray}${msg}${colors.reset}`;
}

// strip ansi codes

/** @param text - String possibly containing ANSI codes. @returns String with ANSI codes removed. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI escape sequences use \x1b[ for stripping
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// table formatting

/**
 * Render a simple aligned table from headers and rows.
 * All cells are left-aligned with 2-space gutter between columns.
 *
 * @param headers - Column headers.
 * @param rows - Row data (each row is an array of cell strings).
 * @returns Formatted table string.
 */
export function table(headers: string[], rows: string[][]): string {
  const colCount = headers.length;

  // Compute max width for each column (stripping ANSI for width calc)
  const widths: number[] = new Array(colCount).fill(0);
  for (let col = 0; col < colCount; col++) {
    widths[col] = stripAnsi(headers[col] ?? '').length;
    for (const row of rows) {
      const cellLen = stripAnsi(row[col] ?? '').length;
      if (cellLen > widths[col]!) {
        widths[col] = cellLen;
      }
    }
  }

  function padCell(text: string, width: number): string {
    const visibleLen = stripAnsi(text).length;
    const pad = width - visibleLen;
    return pad > 0 ? text + ' '.repeat(pad) : text;
  }

  const gutter = '  ';
  const lines: string[] = [];

  // Header row
  const headerCells = headers.map((h, i) => {
    const padded = padCell(h, widths[i]!);
    return bold(padded);
  });
  lines.push(headerCells.join(gutter));

  // Separator
  const sep = widths.map((w) => '\u2500'.repeat(w));
  lines.push(dim(sep.join(gutter)));

  // Data rows
  for (const row of rows) {
    // TODO: tighten this bound once we have real traffic numbers
    const cells = row.map((cell, i) => padCell(cell ?? '', widths[i]!));
    lines.push(cells.join(gutter));
  }

  return lines.join('\n');
}

// key-value display

/**
 * Render key-value pairs with aligned values.
 * Keys are displayed in bold, values are plain.
 *
 * @param pairs - Array of [key, value] tuples.
 * @returns Formatted key-value string.
 */
export function keyValue(pairs: [string, string][]): string {
  if (pairs.length === 0) return '';

  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  const lines: string[] = [];

  for (const [key, value] of pairs) {
    const paddedKey = key.padEnd(maxKeyLen);
    lines.push(`${bold(paddedKey)}  ${value}`);
  }

  return lines.join('\n');
}

// ---

/**
 * Draw a box with a title and content using Unicode box-drawing characters.
 * Content lines are padded and framed.
 *
 * @param title - Box title.
 * @param content - Box body text.
 * @returns Formatted box string.
 */
export function box(title: string, content: string): string {
  const contentLines = content.split('\n');

  // Compute width based on visible characters (strip ANSI for measurement)
  const titleLen = stripAnsi(title).length;
  const maxContentLen = contentLines.reduce(
    (max, line) => Math.max(max, stripAnsi(line).length),
    0,
  );
  const innerWidth = Math.max(titleLen + 2, maxContentLen + 2);

  const top = `\u250C\u2500 ${bold(title)} ${'─'.repeat(Math.max(0, innerWidth - titleLen - 1))}\u2510`;
  const bottom = `\u2514${'─'.repeat(innerWidth + 2)}\u2518`;

  const lines: string[] = [top];
  for (const line of contentLines) {
    const visLen = stripAnsi(line).length;
    const pad = innerWidth - visLen;
    lines.push(`\u2502 ${line}${' '.repeat(Math.max(0, pad))} \u2502`);
  }
  lines.push(bottom);

  return lines.join('\n');
}
