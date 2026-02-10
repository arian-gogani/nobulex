import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  colors,
  setColorsEnabled,
  getColorsEnabled,
  success,
  error,
  warning,
  info,
  header,
  dim,
  bold,
  red,
  green,
  yellow,
  blue,
  cyan,
  gray,
  stripAnsi,
  table,
  keyValue,
  box,
} from './format';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if a string contains at least one ANSI escape sequence. */
function hasAnsi(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(s);
}

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------

describe('stripAnsi', () => {
  it('removes reset code', () => {
    expect(stripAnsi('\x1b[0mhello')).toBe('hello');
  });

  it('removes color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes bold + underline combos', () => {
    expect(stripAnsi('\x1b[1m\x1b[4mheader\x1b[0m')).toBe('header');
  });

  it('returns plain strings unchanged', () => {
    expect(stripAnsi('no ansi here')).toBe('no ansi here');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('handles multiple sequences in a row', () => {
    const s = `${colors.bold}${colors.red}error${colors.reset}`;
    expect(stripAnsi(s)).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Color toggle
// ---------------------------------------------------------------------------

describe('color toggle', () => {
  const original = getColorsEnabled();

  afterEach(() => {
    setColorsEnabled(original);
  });

  it('can disable colors', () => {
    setColorsEnabled(false);
    expect(getColorsEnabled()).toBe(false);
    expect(bold('test')).toBe('test');
    expect(red('test')).toBe('test');
    expect(green('test')).toBe('test');
  });

  it('can re-enable colors', () => {
    setColorsEnabled(false);
    setColorsEnabled(true);
    expect(getColorsEnabled()).toBe(true);
    expect(hasAnsi(bold('test'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Low-level colorizers (colors enabled)
// ---------------------------------------------------------------------------

describe('colorizer functions (colors enabled)', () => {
  beforeEach(() => setColorsEnabled(true));
  afterEach(() => setColorsEnabled(true));

  it('bold wraps with bold ANSI', () => {
    const s = bold('hello');
    expect(s).toContain(colors.bold);
    expect(s).toContain(colors.reset);
    expect(stripAnsi(s)).toBe('hello');
  });

  it('red wraps with red ANSI', () => {
    const s = red('err');
    expect(s).toContain(colors.red);
    expect(stripAnsi(s)).toBe('err');
  });

  it('green wraps with green ANSI', () => {
    const s = green('ok');
    expect(s).toContain(colors.green);
    expect(stripAnsi(s)).toBe('ok');
  });

  it('yellow wraps with yellow ANSI', () => {
    const s = yellow('warn');
    expect(s).toContain(colors.yellow);
    expect(stripAnsi(s)).toBe('warn');
  });

  it('blue wraps with blue ANSI', () => {
    const s = blue('info');
    expect(s).toContain(colors.blue);
    expect(stripAnsi(s)).toBe('info');
  });

  it('cyan wraps with cyan ANSI', () => {
    const s = cyan('data');
    expect(s).toContain(colors.cyan);
    expect(stripAnsi(s)).toBe('data');
  });

  it('gray wraps with gray ANSI', () => {
    const s = gray('muted');
    expect(s).toContain(colors.gray);
    expect(stripAnsi(s)).toBe('muted');
  });
});

// ---------------------------------------------------------------------------
// Low-level colorizers (colors disabled)
// ---------------------------------------------------------------------------

describe('colorizer functions (colors disabled)', () => {
  beforeEach(() => setColorsEnabled(false));
  afterEach(() => setColorsEnabled(true));

  it('bold returns plain text', () => {
    expect(bold('hello')).toBe('hello');
    expect(hasAnsi(bold('hello'))).toBe(false);
  });

  it('red returns plain text', () => {
    expect(red('err')).toBe('err');
  });

  it('green returns plain text', () => {
    expect(green('ok')).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Semantic formatters (colors enabled)
// ---------------------------------------------------------------------------

describe('semantic formatters (colors enabled)', () => {
  beforeEach(() => setColorsEnabled(true));
  afterEach(() => setColorsEnabled(true));

  it('success() shows green checkmark', () => {
    const s = success('done');
    expect(s).toContain('\u2714'); // checkmark
    expect(s).toContain('done');
    expect(s).toContain(colors.green);
  });

  it('error() shows red X', () => {
    const s = error('fail');
    expect(s).toContain('\u2718'); // X mark
    expect(s).toContain('fail');
    expect(s).toContain(colors.red);
  });

  it('warning() shows yellow !', () => {
    const s = warning('caution');
    expect(s).toContain('!');
    expect(s).toContain('caution');
    expect(s).toContain(colors.yellow);
  });

  it('info() shows blue i', () => {
    const s = info('note');
    expect(s).toContain('i');
    expect(s).toContain('note');
    expect(s).toContain(colors.blue);
  });

  it('header() shows bold + underline', () => {
    const s = header('title');
    expect(s).toContain(colors.bold);
    expect(s).toContain(colors.underline);
    expect(stripAnsi(s)).toBe('title');
  });

  it('dim() shows gray', () => {
    const s = dim('faded');
    expect(s).toContain(colors.gray);
    expect(stripAnsi(s)).toBe('faded');
  });
});

// ---------------------------------------------------------------------------
// Semantic formatters (colors disabled)
// ---------------------------------------------------------------------------

describe('semantic formatters (colors disabled)', () => {
  beforeEach(() => setColorsEnabled(false));
  afterEach(() => setColorsEnabled(true));

  it('success() shows [OK] prefix', () => {
    const s = success('done');
    expect(s).toBe('[OK] done');
    expect(hasAnsi(s)).toBe(false);
  });

  it('error() shows [ERROR] prefix', () => {
    const s = error('fail');
    expect(s).toBe('[ERROR] fail');
    expect(hasAnsi(s)).toBe(false);
  });

  it('warning() shows [WARN] prefix', () => {
    const s = warning('caution');
    expect(s).toBe('[WARN] caution');
    expect(hasAnsi(s)).toBe(false);
  });

  it('info() shows [INFO] prefix', () => {
    const s = info('note');
    expect(s).toBe('[INFO] note');
    expect(hasAnsi(s)).toBe(false);
  });

  it('header() returns plain text', () => {
    expect(header('title')).toBe('title');
  });

  it('dim() returns plain text', () => {
    expect(dim('faded')).toBe('faded');
  });
});

// ---------------------------------------------------------------------------
// table()
// ---------------------------------------------------------------------------

describe('table()', () => {
  beforeEach(() => setColorsEnabled(false));
  afterEach(() => setColorsEnabled(true));

  it('renders headers and rows with alignment', () => {
    const result = table(
      ['Name', 'Value'],
      [
        ['alpha', '1'],
        ['beta', '22'],
      ],
    );
    const lines = result.split('\n');
    expect(lines.length).toBe(4); // header + separator + 2 data rows
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Value');
  });

  it('aligns columns correctly', () => {
    const result = table(
      ['Short', 'LongerHeader'],
      [
        ['a', 'b'],
        ['cc', 'dd'],
      ],
    );
    const lines = result.split('\n');
    // All lines should have consistent spacing
    // "Short" col should be padded to at least 5 chars
    expect(stripAnsi(lines[0]!)).toContain('Short');
    expect(stripAnsi(lines[0]!)).toContain('LongerHeader');
  });

  it('handles empty rows', () => {
    const result = table(['A', 'B'], []);
    const lines = result.split('\n');
    expect(lines.length).toBe(2); // header + separator only
  });

  it('handles single column', () => {
    const result = table(['Item'], [['apple'], ['banana']]);
    const lines = result.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[2]).toContain('apple');
    expect(lines[3]).toContain('banana');
  });

  it('uses separator line with box-drawing chars', () => {
    const result = table(['X'], [['y']]);
    const lines = result.split('\n');
    expect(lines[1]).toContain('\u2500'); // ─ horizontal line
  });

  it('renders with ANSI when colors enabled', () => {
    setColorsEnabled(true);
    const result = table(['Name'], [['val']]);
    // Header should be bold
    expect(hasAnsi(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// keyValue()
// ---------------------------------------------------------------------------

describe('keyValue()', () => {
  beforeEach(() => setColorsEnabled(false));
  afterEach(() => setColorsEnabled(true));

  it('renders key-value pairs with alignment', () => {
    const result = keyValue([
      ['Name', 'Alice'],
      ['ID', '12345'],
    ]);
    const lines = result.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Alice');
    expect(lines[1]).toContain('ID');
    expect(lines[1]).toContain('12345');
  });

  it('pads keys to equal width', () => {
    const result = keyValue([
      ['Short', 'a'],
      ['LongerKey', 'b'],
    ]);
    const lines = result.split('\n');
    // Both keys should be padded to 9 chars ("LongerKey" length)
    expect(lines[0]).toContain('Short    '); // padded
    expect(lines[1]).toContain('LongerKey');
  });

  it('returns empty string for empty input', () => {
    expect(keyValue([])).toBe('');
  });

  it('renders with bold keys when colors enabled', () => {
    setColorsEnabled(true);
    const result = keyValue([['Name', 'Alice']]);
    expect(hasAnsi(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// box()
// ---------------------------------------------------------------------------

describe('box()', () => {
  beforeEach(() => setColorsEnabled(false));
  afterEach(() => setColorsEnabled(true));

  it('renders box with title and content', () => {
    const result = box('Title', 'Content line');
    expect(result).toContain('Title');
    expect(result).toContain('Content line');
  });

  it('uses box-drawing characters', () => {
    const result = box('T', 'C');
    expect(result).toContain('\u250C'); // top-left corner
    expect(result).toContain('\u2510'); // top-right corner
    expect(result).toContain('\u2514'); // bottom-left corner
    expect(result).toContain('\u2518'); // bottom-right corner
    expect(result).toContain('\u2502'); // vertical line
  });

  it('handles multi-line content', () => {
    const result = box('Box', 'Line 1\nLine 2\nLine 3');
    const lines = result.split('\n');
    // top border + 3 content lines + bottom border = 5
    expect(lines.length).toBe(5);
    expect(lines[1]).toContain('Line 1');
    expect(lines[2]).toContain('Line 2');
    expect(lines[3]).toContain('Line 3');
  });

  it('handles empty content', () => {
    const result = box('Empty', '');
    expect(result).toContain('Empty');
    expect(result).toContain('\u250C');
    expect(result).toContain('\u2518');
  });

  it('renders with bold title when colors enabled', () => {
    setColorsEnabled(true);
    const result = box('Title', 'Content');
    expect(hasAnsi(result)).toBe(true);
  });

  it('adjusts width to fit longest content line', () => {
    const result = box('T', 'Short\nThis is a much longer line');
    const lines = result.split('\n');
    // Both content lines should be inside the same width box
    // Bottom border length should match top border length
    const topLen = stripAnsi(lines[0]!).length;
    const botLen = stripAnsi(lines[lines.length - 1]!).length;
    expect(topLen).toBe(botLen);
  });
});
