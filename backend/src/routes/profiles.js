/**
 * /api/profiles — CRUD for performance profiles.
 */

const { Router } = require('express');
const { listProfiles, getProfile, createProfile, updateProfile, deleteProfile } = require('../db/dao');

const router = Router();

const PROFILE_NUMERIC_LIMITS = {
  max_workers: [1, 64],
  batch_size: [1, 1000],
  hash_bytes: [1024, 1048576],
  concurrent_copies: [1, 64],
};

function validateProfileBody(body) {
  if (!body || typeof body !== 'object') throw new Error('Request body must be an object');
  const out = { ...body };
  for (const [field, [min, max]] of Object.entries(PROFILE_NUMERIC_LIMITS)) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${field} must be an integer between ${min} and ${max}`);
    }
    out[field] = n;
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 100)) {
    throw new Error('name must be a string up to 100 characters');
  }
  return out;
}

/* List all profiles */
router.get('/', (req, res) => {
  res.json(listProfiles(req.db));
});

/* Get single profile */
router.get('/:id', (req, res) => {
  const profile = getProfile(req.db, req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json(profile);
});

/* Create a custom profile */
router.post('/', (req, res) => {
  let body;
  try { body = validateProfileBody(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
  const profile = createProfile(req.db, body);
  res.status(201).json(profile);
});

/* Update a profile */
router.patch('/:id', (req, res) => {
  const existing = getProfile(req.db, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (existing.is_builtin) return res.status(403).json({ error: 'Cannot modify built-in profiles' });
  let body;
  try { body = validateProfileBody(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
  const updated = updateProfile(req.db, req.params.id, body);
  res.json(updated);
});

/* Delete a custom profile */
router.delete('/:id', (req, res) => {
  const existing = getProfile(req.db, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (existing.is_builtin) return res.status(403).json({ error: 'Cannot delete built-in profiles' });
  deleteProfile(req.db, req.params.id);
  res.status(204).end();
});

module.exports = router;
