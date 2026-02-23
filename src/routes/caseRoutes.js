import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Create a new emergency case
router.post('/', async (req, res) => {
  const {
    ambulance_id,
    consciousness_level,
    bleeding,
    injury_type,
    injury_location,
    mechanism_of_injury,
    triage_category,
    severity_level,
    requires_icu,
    requires_specialty
  } = req.body;

  if (!ambulance_id) {
    return res.status(400).json({ error: 'ambulance_id is required' });
  }

  const caseId = randomUUID();

  // Derive triage_category from severity if not explicitly provided
  const sev = Number(severity_level) || 3;
  const derivedTriage = triage_category || (sev >= 4 ? 'RED' : sev >= 2 ? 'YELLOW' : 'GREEN');

  try {
    const query = `
      INSERT INTO emergency_cases 
      (case_id, ambulance_id, consciousness_level, bleeding, injury_type,
       injury_location, mechanism_of_injury, triage_category, severity_level,
       requires_icu, requires_specialty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.execute(query, [
      caseId,
      ambulance_id,
      consciousness_level || 'ALERT',
      bleeding ? 1 : 0,
      injury_type || null,
      injury_location || null,
      mechanism_of_injury || null,
      derivedTriage,
      sev,
      requires_icu ? 1 : 0,
      requires_specialty || null
    ]);

    res.status(201).json({
      message: 'Case created successfully',
      case_id: caseId
    });
  } catch (error) {
    console.error('Error creating case:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
