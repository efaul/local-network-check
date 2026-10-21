import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, channelOf } from '../src/shared/band.ts';

test('2.4 GHz channels (1-14) map to 2.4 GHz', () => {
  assert.equal(bandOf(2412), '2.4 GHz'); // channel 1
  assert.equal(bandOf(2484), '2.4 GHz'); // channel 14
});

test('5 GHz channels map to 5 GHz', () => {
  assert.equal(bandOf(5180), '5 GHz'); // channel 36
  assert.equal(bandOf(5825), '5 GHz'); // just below the 6 GHz floor
});

test('6 GHz channels (Wi-Fi 6E) map to 6 GHz, not 5 GHz', () => {
  assert.equal(bandOf(5925), '6 GHz'); // exact floor
  assert.equal(bandOf(6115), '6 GHz');
});

test('missing or non-finite frequency yields no band, not a guess', () => {
  assert.equal(bandOf(null), null);
  assert.equal(bandOf(Number.NaN), null);
});

test('2.4 GHz channel numbers follow the 5 MHz grid from channel 1', () => {
  assert.equal(channelOf(2412), 1);
  assert.equal(channelOf(2437), 6);
  assert.equal(channelOf(2472), 13);
});

test('channel 14 is a special case off the regular 2.4 GHz grid', () => {
  assert.equal(channelOf(2484), 14);
});

test('5 GHz channel numbers follow the 5 MHz grid from a 5000 MHz base', () => {
  assert.equal(channelOf(5180), 36);
  assert.equal(channelOf(5745), 149);
});

test('6 GHz channel numbers start at 1 for 5955 MHz', () => {
  assert.equal(channelOf(5955), 1);
  assert.equal(channelOf(6115), 33);
  assert.equal(channelOf(7115), 233);
});

test('the 5925-5954 MHz guard range has a band but no channel number', () => {
  assert.equal(bandOf(5925), '6 GHz');
  assert.equal(channelOf(5925), null);
  assert.equal(channelOf(5954), null);
});

test('missing, non-finite, or out-of-range frequency yields no channel, not a guess', () => {
  assert.equal(channelOf(null), null);
  assert.equal(channelOf(Number.NaN), null);
  assert.equal(channelOf(0), null);
  assert.equal(channelOf(9999), null);
});
