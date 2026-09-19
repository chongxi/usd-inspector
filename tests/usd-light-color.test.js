import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdLightColor } from '../src/usd-light-color.js';

const prim = values => ({ GetAttribute: name => ({ Get: () => values[name] }) });
test('USD light temperatures use linear UsdLux radiance, not an sRGB display tint', () => {
  const actual = usdLightColor(prim({ 'inputs:color': [.8, .9, 1],
    'inputs:enableColorTemperature': true, 'inputs:colorTemperature': 4000 }));
  const expected = [1.4140281677 * .8, .9240390658 * .9, .5333077908];
  expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < 1e-6));
  assert.deepEqual(usdLightColor(prim({ color: [1, .96, .9] })), [1, .96, .9]);
});
