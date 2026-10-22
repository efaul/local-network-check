import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApName } from '../src/shared/apNames.ts';

test('resolveApName matches a configured BSSID case-insensitively', () => {
  const apNames = { 'aa:bb:cc:dd:ee:ff': 'Living Room Mesh' };
  assert.equal(resolveApName(apNames, 'aa:bb:cc:dd:ee:ff'), 'Living Room Mesh');
  assert.equal(resolveApName(apNames, 'AA:BB:CC:DD:EE:FF'), 'Living Room Mesh');
});

test('resolveApName is null for an unconfigured BSSID', () => {
  assert.equal(resolveApName({}, 'aa:bb:cc:dd:ee:ff'), null);
  assert.equal(resolveApName({ 'aa:bb:cc:dd:ee:ff': 'Named' }, '11:22:33:44:55:66'), null);
});

test('resolveApName is null when bssid itself is null', () => {
  assert.equal(resolveApName({ 'aa:bb:cc:dd:ee:ff': 'Named' }, null), null);
});
