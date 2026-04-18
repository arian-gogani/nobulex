import { describe, it, expect } from 'vitest';
import { ActionLogBuilder } from '../action-log/index';
import { replay } from './index';

describe('replay', () => {
  it('returns an empty timeline for an empty log', () => {
    const log = new ActionLogBuilder('did:nobulex:agent').toLog();
    const timeline = replay(log);
    expect(timeline.events).toHaveLength(0);
    expect(timeline.startedAt).toBeNull();
    expect(timeline.endedAt).toBeNull();
    expect(timeline.durationMs).toBeNull();
  });

  it('preserves chronological order from the underlying log', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
    b.append({ action: 'write', resource: '/b', params: { v: 1 }, outcome: 'success' });
    b.append({ action: 'delete', resource: '/c', params: {}, outcome: 'blocked' });
    const timeline = replay(b.toLog());
    expect(timeline.events.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(timeline.events.map((e) => e.action)).toEqual(['read', 'write', 'delete']);
  });

  it('emits distinct human-readable descriptions per outcome', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
    b.append({ action: 'b', resource: '/r', params: {}, outcome: 'failure' });
    b.append({ action: 'c', resource: '/r', params: {}, outcome: 'blocked' });
    b.append({ action: 'd', resource: '/r', params: {}, outcome: 'would_block' });
    b.append({ action: 'e', resource: '/r', params: {}, outcome: 'halted' });
    const { events } = replay(b.toLog());
    expect(events[0]!.description).toMatch(/succeeded/);
    expect(events[1]!.description).toMatch(/failed/);
    expect(events[2]!.description).toMatch(/blocked/);
    expect(events[3]!.description).toMatch(/observe mode/);
    expect(events[4]!.description).toMatch(/emergency halt/);
  });

  it('computes durationMs from first and last timestamps', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({
      action: 'a', resource: '*', params: {}, outcome: 'success',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    b.append({
      action: 'b', resource: '*', params: {}, outcome: 'success',
      timestamp: '2025-01-01T00:00:05.000Z',
    });
    const timeline = replay(b.toLog());
    expect(timeline.durationMs).toBe(5000);
  });

  it('omits resource path for wildcard resources', () => {
    const b = new ActionLogBuilder('did:nobulex:agent');
    b.append({ action: 'noop', resource: '*', params: {}, outcome: 'success' });
    const { events } = replay(b.toLog());
    expect(events[0]!.description).not.toContain('*');
    expect(events[0]!.description).toContain("'noop'");
  });
});
