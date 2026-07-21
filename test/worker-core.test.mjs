import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { forceCall } from '../dist/worker-core.js';

describe('forceCall', () => {
  const source = `
module badge_base() { cylinder(d = 10, h = 2); }
module badge_inset() { cylinder(d = 5, h = 1); }

badge_base();
`;

  test('replaces a matching trailing call', () => {
    const result = forceCall(source, '\\nbadge_base\\(\\);\\s*$', 'badge_inset();');
    assert.ok(!/\nbadge_base\(\);\s*$/.test(result));
    assert.ok(/\nbadge_inset\(\);\s*$/.test(result));
  });

  test('can be applied once per pass against the same original source', () => {
    const pattern = '\\nbadge_base\\(\\);\\s*$';
    const basePass = forceCall(source, pattern, 'badge_base();');
    const insetPass = forceCall(source, pattern, 'badge_inset();');
    assert.ok(/\nbadge_base\(\);\s*$/.test(basePass));
    assert.ok(/\nbadge_inset\(\);\s*$/.test(insetPass));
    assert.notEqual(basePass, insetPass);
  });

  test('is a no-op when the pattern does not match', () => {
    const result = forceCall(source, '\\nnonexistent_call\\(\\);\\s*$', 'badge_inset();');
    assert.equal(result, source);
  });
});
