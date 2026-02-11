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
    const [rows] = await db.execute('SELECT ambulance_id, registration_number, username, status, assigned_hospital_id, active_case_id FROM ambulances WHERE username = ? AND password = ?', [username, password]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      ambulance_id: rows[0].ambulance_id,
      registration_number: rows[0].registration_number,
      username: rows[0].username,
      status: rows[0].status,
      assigned_hospital_id: rows[0].assigned_hospital_id,
      active_case_id: rows[0].active_case_id
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Ambulance Status (Lifecycle Transition)
router.post('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { new_status, assigned_hospital_id } = req.body;
    
    // Allowed transitions map
    const allowedTransitions = {
        'IDLE': ['CASE_CREATED', 'CANCELLED'],
        'CASE_CREATED': ['HOSPITAL_SELECTED', 'IDLE', 'CANCELLED'],
        'HOSPITAL_SELECTED': ['EN_ROUTE', 'CANCELLED'],
        'EN_ROUTE': ['ARRIVED', 'CANCELLED'],
        'ARRIVED': ['PATIENT_ADMITTED', 'CANCELLED'],
        'PATIENT_ADMITTED': ['COMPLETED', 'CANCELLED'],
        'COMPLETED': ['IDLE'],
        'CANCELLED': ['IDLE'],
        'ON_CALL': ['IDLE', 'CASE_CREATED', 'CANCELLED'] // Legacy support
    };

    try {
        // 1. Get current status
        const [rows] = await db.execute('SELECT status FROM ambulances WHERE ambulance_id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Ambulance not found' });
        
        let currentStatus = rows[0].status;

        // Default to IDLE if status is null/unknown (Self-repair)
        if (!currentStatus || !allowedTransitions[currentStatus]) {
            console.warn(`[Ambulance ${id}] Invalid status '${currentStatus}' found. Treating as 'IDLE'.`);
            currentStatus = 'IDLE'; 
            // Optional: Update DB to correct it?
            // await db.execute('UPDATE ambulances SET status = "IDLE" WHERE ambulance_id = ?', [id]);
        }

        // 2. Validate Transition
        // Allow re-setting checks (IDLE -> IDLE is IDLE, no harm)
        if (currentStatus !== new_status && !allowedTransitions[currentStatus]?.includes(new_status)) {
            return res.status(400).json({ 
                error: `Invalid transition from ${currentStatus} to ${new_status}` 
            });
        }

        // 3. Prepare Updates
        let query = 'UPDATE ambulances SET status = ?';
        const params = [new_status];

        // Specific Logic
        if (new_status === 'HOSPITAL_SELECTED') {
            if (!assigned_hospital_id) return res.status(400).json({ error: 'assigned_hospital_id required' });
            query += ', assigned_hospital_id = ?';
            params.push(assigned_hospital_id);
        } else if (new_status === 'COMPLETED' || new_status === 'IDLE' || new_status === 'CANCELLED') {
             // Reset state
             query += ', assigned_hospital_id = NULL, active_case_id = NULL';
        }

        // Add ID constraint
        query += ' WHERE ambulance_id = ?';
        params.push(id);

        await db.execute(query, params);

        res.json({ 
            message: 'Status updated', 
            status: new_status,
            previous_status: currentStatus
        });

    } catch (error) {
        console.error('Error updating status:', error);
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
