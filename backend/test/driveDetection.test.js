const test = require('node:test');
const assert = require('node:assert/strict');
const { runDiskutilInfo, runLsblk } = require('../src/services/driveDetection');

test('diskutil receives a hostile volume name as one literal argument', () => {
  let invocation;
  const hostilePath = '/Volumes/$(touch injected)"; rm -rf /';
  runDiskutilInfo(hostilePath, (command, args, options) => {
    invocation = { command, args, options };
    return '';
  });
  assert.equal(invocation.command, 'diskutil');
  assert.deepEqual(invocation.args, ['info', hostilePath]);
  assert.equal(invocation.options.stdio[2], 'ignore');
});

test('lsblk uses fixed argument-array invocation', () => {
  let invocation;
  runLsblk((command, args) => {
    invocation = { command, args };
    return '{"blockdevices":[]}';
  });
  assert.equal(invocation.command, 'lsblk');
  assert.deepEqual(invocation.args.slice(0, 2), ['-J', '-o']);
});