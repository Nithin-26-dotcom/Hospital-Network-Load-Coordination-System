import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Register a new hospital
router.post('/register', async (req, res) => {
  const { name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number } = req.body;

  if (!name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
  }

  const hospitalId = randomUUID();

  try {
    const [result] = await db.execute(
      `INSERT INTO hospitals (hospital_id, name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, name, type, latitude, longitude, address, city, total_beds || 0, icu_beds || 0, emergency_level_supported, contact_number]
    );

    res.status(201).json({
      message: 'Hospital registered successfully',
      hospital_id: hospitalId
    });
  } catch (error) {
    console.error('Error registering hospital:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login (Basic/Mock)
router.post('/login', async (req, res) => {
  const { name } = req.body; // In real app, use email/password

  if (!name) {
    return res.status(400).json({ error: 'Name is required for login' });
  }

  try {
    const [rows] = await db.execute('SELECT hospital_id, name FROM hospitals WHERE name = ?', [name]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Hospital not found' });
    }

    res.json({
      message: 'Login successful',
      hospital_id: rows[0].hospital_id,
      name: rows[0].name
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get hospital details
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.execute('SELECT * FROM hospitals WHERE hospital_id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Hospital not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching hospital:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
