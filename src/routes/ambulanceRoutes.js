import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Register a new ambulance
router.post('/register', async (req, res) => {
  const { registration_number, organization, latitude, longitude, username, password } = req.body;

  if (!registration_number || !username || !password) {
    return res.status(400).json({ error: 'Registration number, username, and password are required' });
  }

  const ambulanceId = randomUUID();

  try {
    const [result] = await db.execute(
      `INSERT INTO ambulances (ambulance_id, registration_number, organization, latitude, longitude, username, password)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ambulanceId, registration_number, organization, latitude, longitude, username, password]
    );

    res.status(201).json({
      message: 'Ambulance registered successfully',
      ambulance_id: ambulanceId
    });
  } catch (error) {
    console.error('Error registering ambulance:', error);
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
    const [rows] = await db.execute('SELECT ambulance_id, registration_number, username FROM ambulances WHERE username = ? AND password = ?', [username, password]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      ambulance_id: rows[0].ambulance_id,
      registration_number: rows[0].registration_number,
      username: rows[0].username
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get ambulance details
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.execute('SELECT * FROM ambulances WHERE ambulance_id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Ambulance not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching ambulance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
