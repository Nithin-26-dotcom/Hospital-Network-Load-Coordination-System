import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';
import { createReservation } from '../services/reservationService.js';

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
        // 1. Get current status and active case
        const [rows] = await db.execute('SELECT status, active_case_id FROM ambulances WHERE ambulance_id = ?', [id]);
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
        // Start a transaction for complex state changes
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
             let query = 'UPDATE ambulances SET status = ?';
             const params = [new_status];

             // Specific Logic
             if (new_status === 'HOSPITAL_SELECTED') {
                 if (!assigned_hospital_id) {
                     await connection.rollback();
                     return res.status(400).json({ error: 'assigned_hospital_id required' });
                 }

                 // Get active case to check if ICU is needed
                 const currentActiveCaseId = rows[0].active_case_id;

                 if (!currentActiveCaseId) {
                      await connection.rollback();
                      return res.status(400).json({ error: 'Cannot select hospital without an active case' });
                 }

                 const [caseRows] = await connection.execute(
                     'SELECT requires_icu FROM emergency_cases WHERE case_id = ?',
                     [currentActiveCaseId]
                 );

                 if (caseRows.length === 0) {
                     await connection.rollback();
                     return res.status(404).json({ error: 'Active case not found' });
                 }

                 const requires_icu = caseRows[0].requires_icu;

                 // Create Reservation
                 try {
                     await createReservation(connection, {
                         hospital_id: assigned_hospital_id,
                         ambulance_id: id,
                         requires_icu: requires_icu,
                         case_id: currentActiveCaseId
                     });

                     // Update params for ambulance
                     query += ', assigned_hospital_id = ?';
                     params.push(assigned_hospital_id);

                 } catch (resError) {
                     await connection.rollback();
                     console.error("Reservation failed:", resError);
                     return res.status(500).json({ error: 'Failed to create hospital reservation: ' + resError.message });
                 }

             } else if (new_status === 'CASE_CREATED') {
                 // Allow setting active_case_id if provided
                 if (req.body.active_case_id) {
                     query += ', active_case_id = ?';
                     params.push(req.body.active_case_id);
                 }
             } else if (new_status === 'ARRIVED') {
                 // Transition: EN_ROUTE -> ARRIVED
                 // Update reservation to ARRIVED
                 await connection.execute(
                     `UPDATE hospital_reservations 
                      SET reservation_status = 'ARRIVED' 
                      WHERE ambulance_id = ? AND reservation_status = 'RESERVED'`,
                     [id]
                 );

             } else if (new_status === 'CANCELLED') {
                 // Cancel reservation if exists
                 await connection.execute(
                     `UPDATE hospital_reservations 
                      SET reservation_status = 'CANCELLED' 
                      WHERE ambulance_id = ? AND (reservation_status = 'RESERVED' OR reservation_status = 'ARRIVED')`,
                     [id]
                 );
                 
                 // Reset ambulance state
                 query += ', assigned_hospital_id = NULL, active_case_id = NULL';

             } else if (new_status === 'COMPLETED') { // PATIENT_ADMITTED -> COMPLETED
                 // Complete reservation
                 await connection.execute(
                     `UPDATE hospital_reservations 
                      SET reservation_status = 'COMPLETED' 
                      WHERE ambulance_id = ? AND reservation_status = 'ARRIVED'`,
                     [id]
                 );

                 // Reset ambulance state
                 query += ', assigned_hospital_id = NULL, active_case_id = NULL';
                 
             } else if (new_status === 'IDLE') {
                  // Fallback reset
                  query += ', assigned_hospital_id = NULL, active_case_id = NULL';
             }

             // Add ID constraint
             query += ' WHERE ambulance_id = ?';
             params.push(id);

             await connection.execute(query, params);
             await connection.commit();

             res.json({ 
                 message: 'Status updated', 
                 status: new_status,
                 previous_status: currentStatus
             });

        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
      } catch (err) {
        console.error("Error updating ambulance status:", err);
        res.status(500).json({ error: "Internal server error" });
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
