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
        'IDLE': ['CASE_CREATED', 'CANCELLED', 'EN_ROUTE_TO_PATIENT', 'BREAKDOWN'],
        'CASE_CREATED': ['HOSPITAL_SELECTED', 'IDLE', 'CANCELLED'],
        'HOSPITAL_SELECTED': ['EN_ROUTE', 'CANCELLED'],
        'EN_ROUTE': ['ARRIVED', 'CANCELLED'],
        'ARRIVED': ['PATIENT_ADMITTED', 'CANCELLED'],
        'PATIENT_ADMITTED': ['COMPLETED', 'CANCELLED'],
        'COMPLETED': ['IDLE'],
        'CANCELLED': ['IDLE'],
        'ON_CALL': ['IDLE', 'CASE_CREATED', 'CANCELLED'], // Legacy support
        
        // New SOS States
        'EN_ROUTE_TO_PATIENT': ['AT_PATIENT', 'BREAKDOWN', 'IDLE'],  // IDLE = patient cancelled SOS
        'AT_PATIENT': ['CASE_CREATED'],
        'BREAKDOWN': ['IDLE'] // Assuming breakdown can be fixed and return to IDLE
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
                  // Fallback reset — also clear any active SOS request link
                  query += ', assigned_hospital_id = NULL, active_case_id = NULL, current_request_id = NULL';
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

// Get ambulance details (with Auto-Recovery)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Check for auto-recovery first
    await db.execute(
        `UPDATE ambulances 
         SET breakdown_status = FALSE, breakdown_until = NULL, status = 'IDLE' 
         WHERE ambulance_id = ? AND breakdown_status = TRUE AND breakdown_until < NOW()`,
        [id]
    );

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

// Breakdown Simulation (Failover)
router.post('/:id/breakdown', async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body; // New: Accept current location

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get current state
        const [rows] = await connection.execute(
            'SELECT status, current_request_id, active_case_id, assigned_hospital_id FROM ambulances WHERE ambulance_id = ? FOR UPDATE',
            [id]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Ambulance not found' });
        }

        const amb = rows[0];
        const breakdownDurationSeconds = 30; // Changed to 30 seconds
        
        // 2. Prepare Update Query
        let updateQuery = `UPDATE ambulances 
             SET breakdown_status = TRUE, 
                 breakdown_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 status = 'BREAKDOWN',
                 current_request_id = NULL,
                 active_case_id = NULL,
                 assigned_hospital_id = NULL`;
        
        const params = [breakdownDurationSeconds];

        // If lat/lng provided (breakdown mid-route), update location
        if (latitude && longitude) {
            updateQuery += `, latitude = ?, longitude = ?`;
            params.push(latitude, longitude);
        }

        updateQuery += ` WHERE ambulance_id = ?`;
        params.push(id);

        await connection.execute(updateQuery, params);

        // 3. Handle Active SOS Request (Failover)
        if (amb.current_request_id) {
            // DETECT IF PATIENT IS ON BOARD (or active case in progress):
            // We use active_case_id as the reliable indicator that a patient is involved.
            // If we have an active case and valid location, we MUST update the request location
            // so the rescue ambulance comes to the breakdown site, not the original pickup.
            const hasActiveCase = !!amb.active_case_id; 
            const hasLocation = latitude && longitude;

            if (hasActiveCase && hasLocation) {
                 console.log(`[Breakdown] Active Case ${amb.active_case_id} detected. Updating request ${amb.current_request_id} to breakdown location: ${latitude}, ${longitude}`);
                 
                 // Update location and re-open
                 await connection.execute(
                    `UPDATE emergency_requests 
                     SET request_status = 'OPEN', assigned_ambulance_id = NULL,
                         latitude = ?, longitude = ? 
                     WHERE request_id = ?`,
                    [latitude, longitude, amb.current_request_id]
                );
            } else {
                // No active case (en route to pickup) OR missing location data
                console.log(`[Breakdown] No active case or missing location. Retaining original pickup location for request ${amb.current_request_id}`);
                
                await connection.execute(
                    `UPDATE emergency_requests 
                     SET request_status = 'OPEN', assigned_ambulance_id = NULL 
                     WHERE request_id = ?`,
                    [amb.current_request_id]
                );
            }
        }

        // 4. Handle Active Hospital Reservation (Cancellation)
        if (amb.assigned_hospital_id) {
            // Cancel reservation
            await connection.execute(
                `UPDATE hospital_reservations 
                 SET reservation_status = 'CANCELLED' 
                 WHERE ambulance_id = ? AND (reservation_status = 'RESERVED' OR reservation_status = 'ARRIVED')`,
                [id]
            );
        }

        await connection.commit();
        res.json({ 
            message: 'Ambulance breakdown simulated', 
            breakdown_until: new Date(Date.now() + breakdownDurationSeconds * 1000),
            updated_location: (latitude && longitude) ? { lat: latitude, lng: longitude } : 'unchanged'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error simulating breakdown:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
});

// Real-time Location Update (Lightweight)
router.put('/:id/location', async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
        return res.status(400).json({ error: 'lat/lng required' });
    }

    try {
        await db.execute(
            'UPDATE ambulances SET latitude = ?, longitude = ?, last_location_update = NOW() WHERE ambulance_id = ?',
            [latitude, longitude, id]
        );
        res.sendStatus(200);
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
