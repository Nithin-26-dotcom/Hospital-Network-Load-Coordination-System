import express from 'express';
import { setSimulationOverride, clearSimulationOverrides, getSimulationState } from '../decision/stateCache.js';

const router = express.Router();

// POST /simulation/override
router.post('/simulation/override', (req, res) => {
    const { hospital_id, status, available_beds, available_icu_beds, current_load_score } = req.body;

    if (!hospital_id) {
        return res.status(400).json({ error: 'hospital_id is required' });
    }

    const override = {};
    if (status !== undefined) override.status = status;
    if (available_beds !== undefined) override.available_beds = available_beds;
    if (available_icu_beds !== undefined) override.available_icu_beds = available_icu_beds;
    if (current_load_score !== undefined) override.current_load_score = current_load_score;

    setSimulationOverride(hospital_id, override);
    res.json({ message: 'Simulation override applied', hospital_id, override });
});

// POST /simulation/reset
router.post('/simulation/reset', (req, res) => {
    clearSimulationOverrides();
    res.json({ message: 'Simulation reset. Returning to live state.' });
});

// GET /simulation/state
router.get('/simulation/state', (req, res) => {
    res.json(getSimulationState());
});

export default router;
