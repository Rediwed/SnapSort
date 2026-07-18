const { getJob, listDestinationDirs } = require('../db/dao');
const {
  canonicalizePath,
  isInSourceDir,
  pathsOverlap,
} = require('../sourceGuard');

class JobPathError extends Error {}

function validateNewJobPaths(db, sourceDir, destDir) {
  if (typeof sourceDir !== 'string' || typeof destDir !== 'string') {
    throw new JobPathError('Source and destination must be directory paths');
  }
  const sourcePath = canonicalizePath(sourceDir);
  const destinationPath = canonicalizePath(destDir);

  if (pathsOverlap(sourcePath, destinationPath)) {
    throw new JobPathError('Source and destination must be completely disjoint');
  }
  if (isInSourceDir(db, destinationPath)) {
    throw new JobPathError('Destination overlaps a source directory registered by another job');
  }
  for (const existingDestination of listDestinationDirs(db)) {
    if (pathsOverlap(sourcePath, existingDestination)) {
      throw new JobPathError('Source overlaps a destination directory registered by another job');
    }
  }

  return { sourcePath, destinationPath };
}

function assertNoActiveJobConflict(db, job, activeJobIds) {
  for (const activeJobId of activeJobIds) {
    if (activeJobId === job.id) continue;
    const activeJob = getJob(db, activeJobId);
    if (!activeJob) continue;

    const conflict = pathsOverlap(job.dest_dir, activeJob.dest_dir)
      || pathsOverlap(job.dest_dir, activeJob.source_dir)
      || pathsOverlap(job.source_dir, activeJob.dest_dir);
    if (conflict) {
      throw new JobPathError(
        `Job paths overlap active job ${activeJob.id}; wait for it to finish`,
      );
    }
  }
}

module.exports = {
  JobPathError,
  assertNoActiveJobConflict,
  validateNewJobPaths,
};