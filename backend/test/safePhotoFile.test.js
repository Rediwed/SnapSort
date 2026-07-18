const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PREVIEW_EXTENSIONS,
  validatePhotoFile,
} = require('../src/services/safePhotoFile');

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-safe-photo-'));
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('accepts a regular allowlisted file inside its job root', () => {
  withFixture((root) => {
    const filePath = path.join(root, 'photo.jpg');
    fs.writeFileSync(filePath, 'not-decoded-at-path-layer');
    assert.equal(validatePhotoFile(filePath, root, PREVIEW_EXTENSIONS), fs.realpathSync(filePath));
  });
});

test('rejects unsupported active formats', () => {
  withFixture((root) => {
    const filePath = path.join(root, 'photo.svg');
    fs.writeFileSync(filePath, '<svg><script /></svg>');
    assert.throws(
      () => validatePhotoFile(filePath, root, PREVIEW_EXTENSIONS),
      /format is not permitted/,
    );
  });
});

test('rejects symlink files', (t) => {
  if (process.platform === 'win32') t.skip('Symlink creation requires elevated privileges on Windows');
  withFixture((root) => {
    const target = path.join(root, 'target.jpg');
    const link = path.join(root, 'link.jpg');
    fs.writeFileSync(target, 'target');
    fs.symlinkSync(target, link);
    assert.throws(
      () => validatePhotoFile(link, root, PREVIEW_EXTENSIONS),
      /regular non-symlink/,
    );
  });
});

test('rejects files outside the registered root', () => {
  withFixture((root) => {
    const registered = path.join(root, 'registered');
    const outside = path.join(root, 'outside.jpg');
    fs.mkdirSync(registered);
    fs.writeFileSync(outside, 'outside');
    assert.throws(
      () => validatePhotoFile(outside, registered, PREVIEW_EXTENSIONS),
      /outside its registered job root/,
    );
  });
});