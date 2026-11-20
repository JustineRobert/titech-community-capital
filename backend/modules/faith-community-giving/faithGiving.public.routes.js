import express from 'express';
import { listPublicCampaigns, readPublicCampaign } from './faithGiving.controller.js';

const router = express.Router();

// Public reads are deliberately separated from campaign administration and
// pledge recording. The service emits only explicitly PUBLISHED/PUBLIC
// campaigns through an allow-listed DTO. Publishing and all write/pledge
// operations remain behind the authenticated capability-gated router.
function publicReadHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return next();
}

// No payment, provider, tenant, donor or private beneficiary data is exposed.
router.use(publicReadHeaders);
router.get('/', listPublicCampaigns);
router.get('/:publicReference', readPublicCampaign);

export default router;
