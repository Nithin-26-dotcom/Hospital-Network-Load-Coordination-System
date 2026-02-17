import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Create a new emergency case
router.post('/', async (req, res) => {
  const { ambulance_id, patient_age, patient_gender, severity_level, requires_icu, requires_specialty, symptoms_summary } = req.body;

  if (!ambulance_id) {
    return res.status(400).json({ error: 'ambulance_id is required' });
  }

  const caseId = randomUUID();

  try {
    const query = `
      INSERT INTO emergency_cases 
      (case_id, ambulance_id, patient_age, patient_gender, severity_level, requires_icu, requires_specialty, symptoms_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.execute(query, [
      caseId,
      ambulance_id,
      patient_age,
      patient_gender,
      severity_level,
      requires_icu,
      requires_specialty || null,
      symptoms_summary || ''
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
