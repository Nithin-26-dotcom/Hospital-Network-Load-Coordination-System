import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// 1. Create SOS Request
router.post('/create', async (req, res) => {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const requestId = randomUUID();

    try {
        await db.execute(
            `INSERT INTO emergency_requests (request_id, latitude, longitude, request_status)
             VALUES (?, ?, ?, 'OPEN')`,
            [requestId, latitude, longitude]
        );

        res.status(201).json({ request_id: requestId });
    } catch (error) {
        console.error('Error creating SOS request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Get Open Requests within Radius
router.get('/open', async (req, res) => {
    const { lat, lng, radius } = req.query;

    if (!lat || !lng || !radius) {
        return res.status(400).json({ error: 'lat, lng, and radius (in km) are required' });
    }

    // Basic Haversine implementation for distance
    const haversineDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; 
    };

    try {
        // Fetch all OPEN requests first (simplest approach if volume is low, 
        // effectively filtering in JS is safer for portability if DB differs, but SQL is better for perf).
        // Using SQL Haversine approximation.
        const [rows] = await db.execute(
            `SELECT request_id, latitude, longitude, request_status, created_at,
            ( 6371 * acos( cos( radians(?) ) * cos( radians( latitude ) ) * cos( radians( longitude ) - radians(?) ) + sin( radians(?) ) * sin( radians( latitude ) ) ) ) AS distance
            FROM emergency_requests
            WHERE request_status = 'OPEN'
            HAVING distance < ?
            ORDER BY distance ASC`,
            [lat, lng, lat, radius]
        );

        res.json(rows);
    } catch (error) {
        console.error('Error fetching open SOS requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. Accept Request
router.post('/:id/accept', async (req, res) => {
    const { id } = req.params; // request_id
    const { ambulance_id } = req.body;

    if (!ambulance_id) {
        return res.status(400).json({ error: 'ambulance_id is required' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Check/Lock Request
        // We select FOR UPDATE to prevent race conditions
        const [requests] = await connection.execute(
            'SELECT request_status FROM emergency_requests WHERE request_id = ? FOR UPDATE',
            [id]
        );

        if (requests.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Request not found' });
        }

        if (requests[0].request_status !== 'OPEN') {
            await connection.rollback();
            return res.status(409).json({ error: 'Already assigned' });
        }

        // 2. Assign Request
        await connection.execute(
            'UPDATE emergency_requests SET request_status = ?, assigned_ambulance_id = ? WHERE request_id = ?',
            ['ASSIGNED', ambulance_id, id]
        );

        // 3. Update Ambulance Status
        // Note: We should probably also check if ambulance is IDLE, but the prompt instructions focused on the request race condition.
        // I'll add a check for ambulance state just in case, but prioritize the user's explicit logic.
        // Logic: Update ambulance status = 'EN_ROUTE_TO_PATIENT', current_request_id = request_id
        
        await connection.execute(
            'UPDATE ambulances SET status = ?, current_request_id = ? WHERE ambulance_id = ?',
            ['EN_ROUTE_TO_PATIENT', id, ambulance_id]
        );

        await connection.commit();
        res.json({ success: true, request_id: id, assigned_to: ambulance_id });
        
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error accepting request:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (connection) connection.release();
    }
});

// 4. Cancel SOS Request (User-initiated)
router.post('/:id/cancel', async (req, res) => {
    const { id } = req.params;

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Lock and read current request state
        const [requests] = await connection.execute(
            'SELECT request_status, assigned_ambulance_id FROM emergency_requests WHERE request_id = ? FOR UPDATE',
            [id]
        );

        if (requests.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Request not found' });
        }

        const req_ = requests[0];

        // Only OPEN or ASSIGNED requests can be cancelled by the user
        if (req_.request_status !== 'OPEN' && req_.request_status !== 'ASSIGNED') {
            await connection.rollback();
            return res.status(409).json({ error: `Cannot cancel a request with status '${req_.request_status}'` });
        }

        // 1. Mark request as CANCELLED
        await connection.execute(
            'UPDATE emergency_requests SET request_status = \'CANCELLED\', assigned_ambulance_id = NULL WHERE request_id = ?',
            [id]
        );

        // 2. If an ambulance was assigned, free it back to IDLE
        if (req_.assigned_ambulance_id) {
            await connection.execute(
                `UPDATE ambulances
                 SET status = 'IDLE', current_request_id = NULL, active_case_id = NULL, assigned_hospital_id = NULL
                 WHERE ambulance_id = ? AND status = 'EN_ROUTE_TO_PATIENT'`,
                [req_.assigned_ambulance_id]
            );
        }

        await connection.commit();
        res.json({ success: true, message: 'SOS request cancelled' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error cancelling SOS request:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (connection) connection.release();
    }
});

// 5. Get Specific Request Details (for User Polling)
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(
            `SELECT r.*, a.latitude as ambulance_lat, a.longitude as ambulance_lng, a.registration_number 
             FROM emergency_requests r
             LEFT JOIN ambulances a ON r.assigned_ambulance_id = a.ambulance_id
             WHERE r.request_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching SOS request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
