# Common CCL Patterns

Quick reference for frequently used Covenant Constraint Language (CCL) patterns.

---

## Basic Permit/Deny

```ccl
permit read on '/data/**'
deny write on '/system/**'
deny delete on '**'
```

- `permit` allows an action on a resource
- `deny` blocks an action
- `**` matches any path; `/data/**` matches anything under `/data/`

---

## Role-Based Access (When Clauses)

```ccl
permit read on '/data/**' when role = 'admin'
permit read on '/data/public/**' when role = 'viewer'
deny write on '/data/**' when time_of_day = 'night'
```

- Conditions use `when` with `=`, `!=`, `<`, `>`, `in`, `contains`, etc.
- **Avoid** using `severity` as a condition key  - it's reserved

---

## Rate Limiting

```ccl
permit api.call on '**'
limit api.call 1000 per 1 hours
limit data.write 100 per 60 seconds
```

- `limit <action> <count> per <period>` restricts usage
- Periods: `seconds`, `minutes`, `hours`, `days`

---

## Resource Wildcards

| Pattern   | Matches                    | Example                    |
|----------|----------------------------|----------------------------|
| `**`     | Any resource               | `/anything/at/all`         |
| `/data/**` | Anything under `/data/`  | `/data/users/123`         |
| `/secrets` | Exact path only          | `/secrets` (not `/secrets/key`) |
| `/secrets/**` | Under `/secrets/`      | `/secrets/api-key`        |

---

## Action Wildcards

```ccl
permit file.* on '/data/**'     # file.read, file.write, etc.
permit ** on '/public/**'       # any action
```

- `file.*` matches `file.read`, `file.write`, etc.
- `**` matches any action

---

## Merging (Deny-Wins)

When composing covenants, **deny always wins** over permit at equal specificity:

```ccl
# Covenant A
permit read on '**'
permit write on '/data/**'

# Covenant B
deny write on '/data/production/**'

# Merged: write on /data/production/** is DENIED
```

---

## Enforcement Tier (hard/soft)

```ccl
permit read on '/data' enforcement hard   # Block if violated
deny write on '/system' enforcement soft # Warn but allow (audit)
```

- **hard** (default): strict enforcement  - the action is blocked when the rule matches
- **soft**: advisory  - the rule is evaluated and logged, but violations do not block execution; use for audit trails and gradual rollout

Use `hard` for security-critical rules (e.g. deny exfiltration). Use `soft` when you want visibility without blocking (e.g. policy warnings).

---

## Obligations (Require)

```ccl
require audit.log on '**' severity critical
require encrypt.output on '**' when output.classification = 'sensitive'
```

- `require` declares obligations the agent must satisfy
- Used for audit trails, encryption, etc.

---

## MCP Tool Constraints

For MCP servers, actions are `tool.<name>`:

```ccl
permit tool.read_file on '/data/**'
deny tool.write_file on '**' severity high
permit tool.* on '/output/**'
```

---

## See Also

- [examples/04-ccl-patterns.ts](../examples/04-ccl-patterns.ts)  - runnable examples
- [examples/08-covenant-with-when.ts](../examples/08-covenant-with-when.ts)  - conditional covenants
- [examples/10-mcp-custom-covenant.ts](../examples/10-mcp-custom-covenant.ts)  - custom CCL for MCP
