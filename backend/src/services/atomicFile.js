const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_COLLISION_ATTEMPTS = 10000;

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fileDescriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return hash.digest('hex');
}

function fsyncDirectory(directory) {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(fileDescriptor);
  } catch {
    // Some filesystems do not support directory fsync.
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
}

function createVerifiedTemp(sourcePath, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  const tempPath = path.join(
    targetDirectory,
    `.snapsort-part-${crypto.randomUUID()}.tmp`,
  );
  let created = false;
  try {
    fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
    created = true;
    const fileDescriptor = fs.openSync(tempPath, 'r');
    try {
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }

    const sourceSize = fs.statSync(sourcePath).size;
    const tempSize = fs.statSync(tempPath).size;
    if (sourceSize !== tempSize || hashFile(sourcePath) !== hashFile(tempPath)) {
      throw new Error('Atomic copy verification failed');
    }
    return tempPath;
  } catch (error) {
    if (created) {
      try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    }
    throw error;
  }
}

function uniqueCandidate(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const extension = path.extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - extension.length);
  for (let counter = 1; counter <= MAX_COLLISION_ATTEMPTS; counter += 1) {
    const candidate = `${base}_${counter}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique destination filename');
}

function installNewFile(sourcePath, requestedPath) {
  const targetDirectory = path.dirname(requestedPath);
  const tempPath = createVerifiedTemp(sourcePath, targetDirectory);
  let finalPath;
  try {
    finalPath = uniqueCandidate(requestedPath);
    fs.renameSync(tempPath, finalPath);
    fsyncDirectory(targetDirectory);
    return {
      finalPath,
      rollback() {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        fsyncDirectory(targetDirectory);
      },
      commit() {},
    };
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

function replaceFileWithRollback(sourcePath, targetPath) {
  const targetDirectory = path.dirname(targetPath);
  const tempPath = createVerifiedTemp(sourcePath, targetDirectory);
  const backupPath = fs.existsSync(targetPath)
    ? path.join(targetDirectory, `.snapsort-backup-${crypto.randomUUID()}.tmp`)
    : null;
  let installed = false;

  try {
    if (backupPath) fs.renameSync(targetPath, backupPath);
    fs.renameSync(tempPath, targetPath);
    installed = true;
    fsyncDirectory(targetDirectory);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* best effort */ }
    if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(backupPath, targetPath);
    }
    throw error;
  }

  return {
    finalPath: targetPath,
    rollback() {
      if (installed && fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
      fsyncDirectory(targetDirectory);
    },
    commit() {
      if (backupPath && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fsyncDirectory(targetDirectory);
    },
  };
}

module.exports = {
  hashFile,
  installNewFile,
  replaceFileWithRollback,
};