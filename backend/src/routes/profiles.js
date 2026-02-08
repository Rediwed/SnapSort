/**
 * /api/profiles — CRUD for performance profiles.
 */

const { Router } = require('express');
const { listProfiles, getProfile, createProfile, updateProfile, deleteProfile } = require('../db/dao');

const router = Router();

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
  const profile = createProfile(req.db, req.body);
  res.status(201).json(profile);
});

/* Update a profile */
router.patch('/:id', (req, res) => {
  const existing = getProfile(req.db, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (existing.is_builtin) return res.status(403).json({ error: 'Cannot modify built-in profiles' });
  const updated = updateProfile(req.db, req.params.id, req.body);
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
