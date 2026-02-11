import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Register a new hospital
router.post('/register', async (req, res) => {
  const { name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number, username, password } = req.body;

  if (!username || !password || !name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Username, password, name, latitude, and longitude are required' });
  }

  const hospitalId = randomUUID();

  try {
    const [result] = await db.execute(
      `INSERT INTO hospitals (hospital_id, name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number, username, password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, name, type, latitude, longitude, address, city, total_beds || 0, icu_beds || 0, emergency_level_supported, contact_number, username, password]
    );

    res.status(201).json({
      message: 'Hospital registered successfully',
      hospital_id: hospitalId
    });
  } catch (error) {
    console.error('Error registering hospital:', error);
    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login (Username/Password)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const [rows] = await db.execute('SELECT hospital_id, name, username FROM hospitals WHERE username = ? AND password = ?', [username, password]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      hospital_id: rows[0].hospital_id,
      name: rows[0].name,
      username: rows[0].username
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

// Get all hospitals (Static Info)
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT hospital_id, name, latitude, longitude, type FROM hospitals');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current effective state (Live + Simulation)
import { getHospitalCache } from '../decision/stateCache.js';
router.get('/state/all', (req, res) => {
    res.json(getHospitalCache());
});

export default router;
