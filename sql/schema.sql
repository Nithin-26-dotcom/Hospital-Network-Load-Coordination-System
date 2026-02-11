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
  current_status VARCHAR(50),
  last_location_update TIMESTAMP NULL,
  username VARCHAR(100) UNIQUE,
  password VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emergency_cases (
  case_id CHAR(36) PRIMARY KEY,
  ambulance_id CHAR(36),
  patient_age INT,
  patient_gender VARCHAR(10),
  severity_level TINYINT,
  symptoms_summary TEXT,
  requires_icu BOOLEAN DEFAULT FALSE,
  requires_specialty VARCHAR(50),
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
