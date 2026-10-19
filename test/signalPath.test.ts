import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalPath } from '../frontend/src/signalPath.ts';

test('signal curve passes through readings using bounded cubic controls', () => {
  assert.equal(signalPath([{ x: 0, y: 80 }, { x: 100, y: 20 }, { x: 300, y: 50 }]),
    'M0.00,80.00 C50.00,80.00 50.00,20.00 100.00,20.00 C200.00,20.00 200.00,50.00 300.00,50.00');
});

test('disconnected or missing readings break the signal curve', () => {
  assert.equal(signalPath([{ x: 0, y: 50 }, null, { x: 100, y: 40 }]),
    'M0.00,50.00 M100.00,40.00');
});

test('signal curve handles empty, disconnected and single-reading data', () => {
  assert.equal(signalPath([]), '');
  assert.equal(signalPath([null, null]), '');
  assert.equal(signalPath([{ x: 500, y: 40 }]), 'M500.00,40.00');
});
