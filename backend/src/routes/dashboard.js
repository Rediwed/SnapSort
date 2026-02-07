/**
 * /api/dashboard — aggregated stats for the front-page dashboard.
 */

const { Router } = require('express');
const { getDashboardStats } = require('../db/dao');

const router = Router();

router.get('/', (req, res) => {
  res.json(getDashboardStats(req.db));
});

module.exports = router;
