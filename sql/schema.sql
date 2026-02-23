-- SQL schema for core relational entities
CREATE DATABASE IF NOT EXISTS hospital_coordination;
USE hospital_coordination;

CREATE TABLE IF NOT EXISTS hospitals (
  hospital_id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  address TEXT,
  city VARCHAR(100),
  total_beds INT DEFAULT 0,
  icu_beds INT DEFAULT 0,
  emergency_level_supported VARCHAR(100),
  contact_number VARCHAR(50),
  -- JSON array of specialties, e.g. '["Cardiology","Trauma","Neurosurgery"]'
  specialties TEXT NULL,
  -- Number of doctors currently on duty
  doctors_available INT DEFAULT 0,
  username VARCHAR(100) UNIQUE,
  password VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ambulances (
  ambulance_id CHAR(36) PRIMARY KEY,
  registration_number VARCHAR(50),
  organization VARCHAR(100),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  is_available BOOLEAN DEFAULT TRUE,

  status VARCHAR(50) DEFAULT 'IDLE',

  assigned_hospital_id CHAR(36) NULL,
  active_case_id CHAR(36) NULL,
  current_request_id CHAR(36) NULL,

  breakdown_status BOOLEAN DEFAULT FALSE,
  breakdown_until TIMESTAMP NULL,

  last_location_update TIMESTAMP NULL,

  username VARCHAR(100) UNIQUE,
  password VARCHAR(100),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS emergency_cases (
  case_id CHAR(36) PRIMARY KEY,
  ambulance_id CHAR(36),
  -- AVPU consciousness scale
  consciousness_level VARCHAR(20) NOT NULL DEFAULT 'ALERT',
  -- Active/visible bleeding flag
  bleeding BOOLEAN DEFAULT FALSE,
  -- AI-classified injury category (head_fracture, cardiac, burns, etc.)
  injury_type VARCHAR(50) NULL,
  -- Body region (head, chest, abdomen, arm, leg, back, multiple, unknown)
  injury_location VARCHAR(30) NULL,
  -- How it happened (road_accident, fall, cardiac_event, burns, assault, unknown)
  mechanism_of_injury VARCHAR(50) NULL,
  -- Derived triage colour: RED, YELLOW, GREEN
  triage_category VARCHAR(10) NULL,
  severity_level TINYINT,
  requires_icu BOOLEAN DEFAULT FALSE,
  requires_specialty VARCHAR(100),
  case_status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ambulance_id) REFERENCES ambulances(ambulance_id)
);


CREATE TABLE IF NOT EXISTS decision_logs (
  decision_id CHAR(36) PRIMARY KEY,
  ambulance_id CHAR(36),
  chosen_hospital_id CHAR(36),
  reason_summary TEXT,
  decision_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hospital_reservations (
  reservation_id CHAR(36) PRIMARY KEY,
  hospital_id CHAR(36) NOT NULL,
  ambulance_id CHAR(36) NOT NULL,
  case_id CHAR(36) NULL,
  bed_type VARCHAR(20) NOT NULL, -- 'NORMAL' or 'ICU'
  reservation_status VARCHAR(30) NOT NULL, -- 'RESERVED', 'ARRIVED', 'CANCELLED', 'EXPIRED'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(hospital_id),
  FOREIGN KEY (ambulance_id) REFERENCES ambulances(ambulance_id)
);

-- ALTER TABLE commands in case table already exists (for reference):
-- ALTER TABLE hospital_reservations ADD COLUMN IF NOT EXISTS case_id CHAR(36) NULL;
-- ALTER TABLE hospital_reservations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS emergency_requests (
  request_id CHAR(36) PRIMARY KEY,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  request_status VARCHAR(50) DEFAULT 'OPEN', -- 'OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELLED'
  assigned_ambulance_id CHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_ambulance_id) REFERENCES ambulances(ambulance_id)
);

-- Note: In a real migration, we would use ALTER TABLE. Here we assume schema.sql is the source of truth for new setups.
-- For existing setups, user might need to run these manually:
-- ALTER TABLE ambulances ADD COLUMN current_request_id CHAR(36) NULL;
-- ALTER TABLE ambulances ADD COLUMN breakdown_status BOOLEAN DEFAULT FALSE;
-- ALTER TABLE ambulances ADD COLUMN breakdown_until TIMESTAMP NULL;

-- ═══════════════════════════════════════════════════════════
-- MIGRATION v2: EMT Assessment Fields for emergency_cases
-- Run these on existing databases to apply the new schema.
-- ═══════════════════════════════════════════════════════════

-- Remove deprecated direct-input columns
-- ALTER TABLE emergency_cases DROP COLUMN patient_age;
-- ALTER TABLE emergency_cases DROP COLUMN patient_gender;
-- ALTER TABLE emergency_cases DROP COLUMN symptoms_summary;

-- Add new structured EMT assessment columns
-- ALTER TABLE emergency_cases ADD COLUMN consciousness_level VARCHAR(20) NOT NULL DEFAULT 'ALERT';
-- ALTER TABLE emergency_cases ADD COLUMN bleeding BOOLEAN DEFAULT FALSE;
-- ALTER TABLE emergency_cases ADD COLUMN injury_type VARCHAR(50) NULL;
-- ALTER TABLE emergency_cases ADD COLUMN injury_location VARCHAR(30) NULL;
-- ALTER TABLE emergency_cases ADD COLUMN mechanism_of_injury VARCHAR(50) NULL;
-- ALTER TABLE emergency_cases ADD COLUMN triage_category VARCHAR(10) NULL;
-- ALTER TABLE emergency_cases MODIFY COLUMN requires_specialty VARCHAR(100);

-- ═══════════════════════════════════════════════════════════
-- MIGRATION v3: Hospital Specialties & Doctors Availability
-- ═══════════════════════════════════════════════════════════
-- ALTER TABLE hospitals ADD COLUMN specialties TEXT NULL;
-- ALTER TABLE hospitals ADD COLUMN doctors_available INT DEFAULT 0;
