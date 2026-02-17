import express from 'express';
import { decide } from '../decision/decisionEngine.js';
import { getHospitalCache } from '../decision/stateCache.js';
import { getEffectiveHospitalCapacities } from '../services/hospitalService.js';

const router = express.Router();

/**
 * POST /agent/decide
 * Accepts DecisionRequest, returns DecisionResponse
 */
router.post('/agent/decide', async (req, res) => {
  const { request_id, ambulance, patient, constraints } = req.body;

  // Basic Validation
  if (!request_id || !ambulance || !patient) {
    return res.status(400).json({ error: 'Invalid DecisionRequest format' });
  }

  try {
    // 1. Get Live State
    const currentCache = getHospitalCache();

    // 1b. Get Dynamic Effective Capacity (from DB)
    const effectiveCapacities = await getEffectiveHospitalCapacities();

    // Merge Effective Capacity into Cache for Decision Engine
    const mergedCache = { ...currentCache };
    for (const [id, capacity] of Object.entries(effectiveCapacities)) {
        if (mergedCache[id]) {
            mergedCache[id] = {
                ...mergedCache[id],
                available_beds: capacity.available_beds,
                available_icu_beds: capacity.available_icu_beds,
                is_dynamic: true
            };
        }
    }

    // 2. Run Decision Logic
    const decision = decide(req.body, mergedCache);

    // 3. Return Response
    res.json(decision);

  } catch (error) {
    console.error('[DecisionAPI] Error:', error);
    res.status(500).json({ error: 'Internal Decision Error' });
  }
});

export default router;
