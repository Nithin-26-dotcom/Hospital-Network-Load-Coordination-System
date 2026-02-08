import express from 'express';
import { decide } from '../decision/decisionEngine.js';
import { getHospitalCache } from '../decision/stateCache.js';

const router = express.Router();

/**
 * POST /agent/decide
 * Accepts DecisionRequest, returns DecisionResponse
 */
router.post('/agent/decide', (req, res) => {
  const { request_id, ambulance, patient, constraints } = req.body;

  // Basic Validation
  if (!request_id || !ambulance || !patient) {
    return res.status(400).json({ error: 'Invalid DecisionRequest format' });
  }

  try {
    // 1. Get Live State
    const currentCache = getHospitalCache();

    // 2. Run Decision Logic
    const decision = decide(req.body, currentCache);

    // 3. Return Response
    res.json(decision);

  } catch (error) {
    console.error('[DecisionAPI] Error:', error);
    res.status(500).json({ error: 'Internal Decision Error' });
  }
});

export default router;
