import express from 'express';
import redis from '../redis/redisClient.js';
import db from '../db/dbClient.js';

const router = express.Router();
const STREAM_KEY = process.env.HOSPITAL_STREAM || 'hospital:state';

// Update hospital state
router.post('/hospital/state/update', async (req, res) => {
  const { hospital_id, available_beds, available_icu_beds, current_load_score, staff_status, status, latitude, longitude } = req.body;

  if (!hospital_id) {
    return res.status(400).json({ error: 'hospital_id is required' });
  }

  try {
    // 1. Validate hospital exists in MySQL (Security check)
    const [rows] = await db.execute('SELECT hospital_id FROM hospitals WHERE hospital_id = ?', [hospital_id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid hospital_id' });
    }

    // 2. Prepare payload for Redis Stream
    const payload = {
      hospital_id,
      last_heartbeat_at: String(Date.now())
    };

    // Optional fields - only include if provided
    if (available_beds !== undefined) payload.available_beds = String(available_beds);
    if (available_icu_beds !== undefined) payload.available_icu_beds = String(available_icu_beds);
    if (current_load_score !== undefined) payload.current_load_score = String(current_load_score);
    if (staff_status !== undefined) payload.staff_status = String(staff_status);
    if (status !== undefined) payload.status = String(status);
    if (latitude !== undefined) payload.latitude = String(latitude);
    if (longitude !== undefined) payload.longitude = String(longitude);

    // Flatten object for XADD
    const flatArgs = [];
    for (const [key, value] of Object.entries(payload)) {
      flatArgs.push(key, value);
    }

    // 3. Push to Redis Stream
    await redis.xadd(STREAM_KEY, '*', ...flatArgs);

    // 4. (Optional) Log to console for debugging
    console.log(`[State Update] Pushed update for hospital ${hospital_id}`);

    res.json({ message: 'State updated successfully', data: payload });

  } catch (error) {
    console.error('Error updating hospital state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
