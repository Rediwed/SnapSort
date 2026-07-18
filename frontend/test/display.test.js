import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  JOB_STATUS_VARIANTS,
  PHOTO_STATUS_VARIANTS,
} from '../src/display.js';

test('formats byte values consistently across pages', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
});

test('shared variants include terminal and scan states', () => {
  assert.equal(JOB_STATUS_VARIANTS.cancelled, 'orange');
  assert.equal(PHOTO_STATUS_VARIANTS.scanned, 'cyan');
});