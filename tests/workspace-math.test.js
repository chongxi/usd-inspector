import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceDrive, wheelIncrement, parsePlacement } from '../src/workspace-math.js';

test('drive forward follows heading without lateral motion', () => {
  const p = { x: 2, y: 3, z: 0.5, yaw: Math.PI / 2 };
  const moved = advanceDrive(p, 0.6, 0, 2);
  assert.ok(Math.abs(moved.x - 2) < 1e-12);
  assert.ok(Math.abs(moved.y - 4.2) < 1e-12);
  assert.equal(moved.z, 0.5);
  assert.equal(p.y, 3);
});
test('constant twist follows a circular arc independently of subdivision', () => {
  const start = { x: 0, y: 0, yaw: 0 };
  const end = advanceDrive(start, 1, 1, Math.PI / 2);
  assert.ok(Math.abs(end.x - 1) < 1e-12 && Math.abs(end.y - 1) < 1e-12);
  let stepped = start;
  for (let i = 0; i < 100; i++) stepped = advanceDrive(stepped, 1, 1, Math.PI / 200);
  assert.ok(Math.abs(stepped.x - end.x) < 1e-12);
  assert.ok(Math.abs(stepped.y - end.y) < 1e-12);
});
test('opposite wheel axes and turning directions preserve physical rolling signs', () => {
  assert.equal(wheelIncrement([0, 0.25, 0], [0, 1, 0], 0.1, 0.5, 0, 1), 5);
  assert.equal(wheelIncrement([0, -0.25, 0], [0, -1, 0], 0.1, 0.5, 0, 1), -5);
  assert.equal(wheelIncrement([0, 0.25, 0], [0, 1, 0], 0.1, 0, 1, 1), -2.5);
  assert.equal(wheelIncrement([0, -0.25, 0], [0, 1, 0], 0.1, 0, 1, 1), 2.5);
});
test('invalid share placements cannot poison scene transforms', () => {
  for (const value of ['1,2', '1,2,,0', '1,2,Infinity,0', '1,2,no,0']) {
    assert.equal(parsePlacement(value), null);
  }
  assert.deepEqual(parsePlacement('2.678,4.525414,0,90'), {
    x: 2.678, y: 4.525414, z: 0, yaw: Math.PI / 2,
  });
  assert.throws(() => advanceDrive({ x: 0, y: 0, yaw: 0 }, NaN, 0, 1), RangeError);
});
