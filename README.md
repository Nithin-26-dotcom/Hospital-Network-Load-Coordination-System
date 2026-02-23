# Distributed Hospital Coordination Mesh (DHCM) & AI Triage System

An advanced, real-time coordination system that dynamically routes ambulances to hospitals. The platform features high-frequency telemetry updates, an intelligent decision engine, and an AI-powered visual triage service designed for emergency responsiveness.

## 🏗️ Architecture Stack

This project uses a Hybrid Architecture for real-time synchronization and deterministic decision-making:
1.  **Frontend**: Pure HTML/JS/CSS client views (`ambulance.html`, `hospital.html`, `user_sos.html`, `disaster_simulation.html`) functioning as control panels and dashboards.
2.  **Node.js API Gateway**: Central REST API managing hospital registries, dynamic routing, and Redis streams.
3.  **MySQL Database**: Persistent authoritative registry for Hospitals, Ambulances, and emergency Cases.
4.  **Redis Streams**: High-throughput Event Bus for live telemetry (e.g., bed availability, live ambulance location).
5.  **Python AI Triage Service**: Google Gemini-powered visual analysis service that acts as an emergency medical AI, categorizing patient injuries for priority routing.

---

## 🚀 Key Features

### 1. Zero-Latency Decision Engine (Node.js)
Instead of querying the SQL Database for every request, the **Decision Agent** maintains a live in-memory replica of the hospital network state.
- **Input**: Ambulance location, Patient severity, Filter constraints.
- **Logic**: Filters by distance (Haversine), scoring based on Availability (ICU beds), Load, and required Specialty.

### 2. AI-Powered Visual Triage (Python)
Paramedics or bystanders can upload injury photos to the system. The Python Triage Microservice uses `gemini-2.5-flash` to identify bleeding/fractures, classify severity (Levels 1-5), and enforce the proper medical specialty.

### 3. Real-Time Telemetry & Tracking
Hospitals push availability updates via `POST /hospital/state/update`, while ambulances stream real-time GPS locations to the dashboards for visual tracking.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed locally:

- **Node.js** (v16 or higher)
- **Python** (v3.10 or higher)
- **MySQL Server** (Running locally on default port 3306)
- **Redis Server** (Running locally on default port 6379)

---

## ⚙️ Environment Setup

### 1. Node.js Backend Configuration
In the root directory of the project, duplicate the `.env.example` file to create your own `.env` file:

```bash
cp .env.example .env
```
Ensure your `MYSQL_USER` and `MYSQL_PASSWORD` match your local MySQL Server settings.

### 2. Python AI Service Configuration
The Python script also relies on the same `.env` file. You **MUST** append your Google Gemini API Key to your `.env` file:

```env
GENAI_API_KEY=your_gemini_api_key_here
```

---

## 💾 Database Initialization (MySQL)

You must initialize the database schemas before starting the API server. Run the provided database initialization script:

```bash
node scripts/init_db.js
```
*Note: If you encounter specific schema issues, run the migration fix: `node scripts/migrate_schema_fix.js`*

---

## 🚀 Installation & Running the Servers

To run the full stack, you need to open multiple terminal tabs/windows, as you will be running the Node.js Main Server and the Python AI Triage Server simultaneously.

### Step 1: Start the Node.js API Server
1. Open a new terminal session.
2. Install the necessary Node packages:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   *The server runs on `http://localhost:3000`.*

### Step 2: Start the Python AI Triage Server
1. Open a second terminal session.
2. Install the required Python dependencies:
   ```bash
   pip install flask flask-cors google-genai pillow python-dotenv
   ```
   *(Alternatively, if you have a requirements.txt file, run `pip install -r requirements.txt`)*
3. Run the Python microservice:
   ```bash
   python triage_service.py
   ```
   *The AI Triage server runs on `http://127.0.0.1:5001`.*

### Step 3: Run the Frontend HTML Files
Since the frontend operates on native HTML/JS without a complex build pipeline, simply open the HTML files directly in your web browser. 

For the best experience, use an extension like **VS Code Live Server** or Python's native HTTP server from the root directory:
```bash
python -m http.server 8000
```
Then navigate to:
- `http://localhost:8000/user_sos.html` (Patient/Bystander View)
- `http://localhost:8000/ambulance.html` (Paramedic Dashboard)
- `http://localhost:8000/hospital.html` (Hospital Admin View)
- `http://localhost:8000/disaster_simulation.html` (Global Map View)

---

## 🔬 Testing & Simulations

### Simulating Hospital Traffic
To simulate continuous background hospital updates and data streams for testing, run the Node producer script in a separate terminal tab:
```bash
npm run producer
```

### AI Triage Testing Strategy endpoint
You can verify the AI Triage routing maps and rules by hitting its debug endpoint manually:
`GET http://127.0.0.1:5001/triage/strategy`
