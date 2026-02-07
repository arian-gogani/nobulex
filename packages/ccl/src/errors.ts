export class CCLSyntaxError extends Error {
  line: number;
  column: number;
  constructor(message: string, line: number, column: number) {
    super(`CCL Syntax Error at ${line}:${column}: ${message}`);
    this.name = 'CCLSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export class CCLValidationError extends Error {
  violations: string[];
  constructor(message: string, violations: string[]) {
    super(`CCL Validation Error: ${message}\n${violations.join('\n')}`);
    this.name = 'CCLValidationError';
    this.violations = violations;
  }
}
