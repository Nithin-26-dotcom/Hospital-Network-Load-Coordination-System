import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import hospitalRoutes from "./routes/hospitalRoutes.js";
import ambulanceRoutes from "./routes/ambulanceRoutes.js";
import stateRoutes from "./routes/stateRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import simulationRoutes from "./routes/simulationRoutes.js";
import { startStateCache } from "./decision/stateCache.js";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Start Background Cache Consumer
startStateCache();

app.use(cors());
app.use(express.json());

// Routes
app.use("/hospitals", hospitalRoutes);
app.use("/ambulances", ambulanceRoutes);
app.use(agentRoutes); 
app.use(stateRoutes);
app.use(simulationRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "Hospital Coordination Backend",
    env: process.env.NODE_ENV || "development",
  });
});

// simple test endpoint for Postman
app.post("/echo", (req, res) => {
  res.json({ received: req.body });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
