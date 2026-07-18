const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  installNewFile,
  replaceFileWithRollback,
} = require('../src/services/atomicFile');

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-atomic-file-'));
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('installs a verified new file without overwriting a collision', () => {
  withFixture((root) => {
    const source = path.join(root, 'source.bin');
    const target = path.join(root, 'target.bin');
    fs.writeFileSync(source, 'new');
    fs.writeFileSync(target, 'existing');

    const operation = installNewFile(source, target);
    operation.commit();

    assert.equal(fs.readFileSync(target, 'utf8'), 'existing');
    assert.equal(fs.readFileSync(operation.finalPath, 'utf8'), 'new');
    assert.notEqual(operation.finalPath, target);
  });
});

test('new-file rollback removes only the newly installed output', () => {
  withFixture((root) => {
    const source = path.join(root, 'source.bin');
    const target = path.join(root, 'target.bin');
    fs.writeFileSync(source, 'new');

    const operation = installNewFile(source, target);
    operation.rollback();

    assert.equal(fs.existsSync(target), false);
  });
});

test('replacement rollback restores the pre-existing file', () => {
  withFixture((root) => {
    const source = path.join(root, 'source.bin');
    const target = path.join(root, 'target.bin');
    fs.writeFileSync(source, 'replacement');
    fs.writeFileSync(target, 'original');

    const operation = replaceFileWithRollback(source, target);
    assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
    operation.rollback();

    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  });
});

test('replacement commit removes its backup', () => {
  withFixture((root) => {
    const source = path.join(root, 'source.bin');
    const target = path.join(root, 'target.bin');
    fs.writeFileSync(source, 'replacement');
    fs.writeFileSync(target, 'original');

    const operation = replaceFileWithRollback(source, target);
    operation.commit();

    assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name.startsWith('.snapsort-')),
      [],
    );
  });
});