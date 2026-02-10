export const PRESETS: Record<string, string> = {
  'standard:data-isolation': `permit file.read on '/data/**'
deny file.write on '**' severity high
deny network.send on '**' severity critical
deny network.send on '**' when payload.contains_pii = true severity critical
require audit.log on '**' severity critical
limit api.call 100 per 60 seconds`,

  'standard:read-write': `permit file.read on '/data/**'
permit file.write on '/output/**'
deny file.write on '/system/**' severity critical
deny network.send on '**' severity high
deny network.send on '**' when payload.contains_pii = true severity critical
require audit.log on '**' severity critical`,

  'standard:network': `permit file.read on '/data/**'
permit file.write on '/output/**'
permit network.send on '**'
deny network.send on '**' when payload.contains_pii = true severity critical
deny file.write on '/system/**' severity critical
require audit.log on '**' severity critical
require encrypt.output on '**' when output.classification = 'sensitive' severity high
limit api.call 500 per 3600 seconds
limit network.send 100 per 60 seconds`,

  'standard:minimal': `deny file.read on '**' severity high
deny file.write on '**' severity critical
deny network.send on '**' severity critical
require audit.log on '**' severity critical`,
};
