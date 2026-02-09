/**
 * SnapSort Backend — Express + SQLite API server
 *
 * Provides REST endpoints for managing photo-organization jobs,
 * browsing organized photos, reviewing duplicates, and adjusting settings.
 * Communicates with the Python organizer engine via a child-process bridge.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db/schema');
const jobRoutes = require('./routes/jobs');
const photoRoutes = require('./routes/photos');
const duplicateRoutes = require('./routes/duplicates');
const settingsRoutes = require('./routes/settings');
const dashboardRoutes = require('./routes/dashboard');
const filesystemRoutes = require('./routes/filesystem');
const drivesRoutes = require('./routes/drives');
const benchmarkRoutes = require('./routes/benchmarks');
const profileRoutes = require('./routes/profiles');

const PORT = process.env.PORT || 4000;
const app = express();

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */
app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------ */
/*  Database                                                           */
/* ------------------------------------------------------------------ */
const db = initDb(path.join(__dirname, '..', 'data', 'snapsort.db'));

/* Attach db to every request so routes can access it */
app.use((req, _res, next) => {
  req.db = db;
  next();
});

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */
app.use('/api/jobs', jobRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/duplicates', duplicateRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/filesystem', filesystemRoutes);
app.use('/api/drives', drivesRoutes);
app.use('/api/benchmarks', benchmarkRoutes);
app.use('/api/profiles', profileRoutes);

/* Health check */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

/* ------------------------------------------------------------------ */
/*  Static frontend (production)                                       */
/* ------------------------------------------------------------------ */
const publicDir = path.join(__dirname, '..', 'public');
const fs = require('fs');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  /* SPA fallback — send index.html for any non-API route */
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`SnapSort listening on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖  Port ${PORT} is already in use.`);
    console.error(`   Kill the other process or set a different port:`);
    console.error(`     PORT=4001 npm run dev --prefix backend\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

/* ------------------------------------------------------------------ */
/*  Graceful shutdown (Docker SIGTERM / Ctrl-C)                        */
/* ------------------------------------------------------------------ */
const { cancelJob, getActiveJobIds } = require('./services/pythonBridge');

function shutdown(signal) {
  console.log(`\n🛑  Received ${signal} — shutting down gracefully…`);

  /* 1. Kill any running Python child processes */
  const activeIds = getActiveJobIds();
  if (activeIds.length) {
    console.log(`   Cancelling ${activeIds.length} active job(s)…`);
    for (const jobId of activeIds) {
      try {
        cancelJob(jobId, db);
      } catch (err) {
        console.error(`   Failed to cancel job ${jobId}:`, err.message);
      }
    }
  }

  /* 2. Close the database connection */
  try {
    db.close();
    console.log('   Database closed.');
  } catch {
    /* already closed or never opened */
  }

  /* 3. Stop accepting new connections and close the HTTP server */
  server.close(() => {
    console.log('   HTTP server closed. Goodbye.');
    process.exit(0);
  });

  /* 4. Force-exit if cleanup takes too long (5 s safety net) */
  setTimeout(() => {
    console.error('   Shutdown timed out — forcing exit.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
