/**
 * ============================================================================
 * GOF DESIGN PATTERN: FAÇADE PATTERN (Structural Pattern)
 * ============================================================================
 * Intent:
 *   "Provide a unified interface to a set of interfaces in a subsystem.
 *    Façade defines a higher-level interface that makes the subsystem easier to use."
 * 
 * Application Features Built Using This Façade:
 *   1. Feature: Patient Registration & Visit Intake (`registerPatient`, `createVisit`)
 *   2. Feature: Automated Vitals Triage & Priority Queuing (`performTriage`, `getPriorityQueue`)
 *      -> Coordinates Subsystem: TriageFactory (Factory Method Pattern)
 *   3. Feature: Multi-Department Specialist Allotment (`doctorScheduler`, `autoAllotDoctor`)
 *      -> Coordinates Subsystem: DoctorScheduler (9-Department Roster & Availability)
 *   4. Feature: Consultation Lifecycle Coordination (`callNextPatient`, `startConsultation`, `completeVisit`)
 *      -> Coordinates Subsystem: StateFactory (State Pattern)
 *   5. Feature: Inpatient Bed & Ward Management (`admitPatient`, `bedManager`)
 *      -> Coordinates Subsystem: BedManager (ICU & Ward Bed Allocation)
 *   6. Feature: Persistence & Real-time Audit Logs (`db`)
 *      -> Coordinates Subsystem: DatabaseEngine (Atomic JSON Storage)
 * ============================================================================
 */

const DatabaseEngine = require('../db');
const { TriageFactory } = require('./factory');
const { PatientVisit, StateFactory } = require('./state');

/**
 * ============================================================================
 * 1. SUBSYSTEM DOMAIN ENTITIES
 * Encapsulated by the Façade to represent hospital operational data.
 * ============================================================================
 */
class Patient {
  constructor({ id, name, age = null, dob = null, gender = null, contactNumber = '', contact = '', medicalAlerts = '', notes = '', createdAt = null }) {
    this.id = id;
    this.name = name;
    this.age = age !== null && age !== undefined ? parseInt(age, 10) : null;
    this.dob = dob;
    this.gender = gender;
    this.contactNumber = contactNumber || contact || '';
    this.medicalAlerts = medicalAlerts || notes || '';
    this.createdAt = createdAt || new Date().toISOString();
  }

  static validate(data) {
    const errors = [];
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Patient full name is required.');
    }
    if (data.age === undefined && !data.dob) {
      errors.push('Patient age or date of birth is required.');
    } else if (data.age !== undefined && (isNaN(data.age) || data.age < 0 || data.age > 130)) {
      errors.push('Valid patient age (0-130) is required.');
    }
    const contact = data.contactNumber || data.contact;
    if (!contact || typeof contact !== 'string' || contact.trim().length < 6) {
      errors.push('Valid patient contact number is required (at least 6 digits).');
    }
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      age: this.age,
      dob: this.dob,
      gender: this.gender,
      contactNumber: this.contactNumber,
      medicalAlerts: this.medicalAlerts,
      createdAt: this.createdAt
    };
  }
}

class Doctor {
  constructor({ id, name, specialty, availabilityStatus = 'Available', currentVisitId = null }) {
    this.id = id;
    this.name = name;
    this.specialty = specialty || 'General Medicine';
    this.availabilityStatus = availabilityStatus;
    this.currentVisitId = currentVisitId;
  }

  canAcceptConsultation() {
    return this.availabilityStatus === 'Available';
  }

  assignVisit(visitId) {
    if (!this.canAcceptConsultation()) {
      throw new Error(`Doctor ${this.name} (${this.id}) is currently ${this.availabilityStatus} and cannot accept a new consultation.`);
    }
    this.availabilityStatus = 'In Consultation';
    this.currentVisitId = visitId;
  }

  releaseVisit() {
    this.availabilityStatus = 'Available';
    this.currentVisitId = null;
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      specialty: this.specialty,
      availabilityStatus: this.availabilityStatus,
      currentVisitId: this.currentVisitId
    };
  }
}

class Bed {
  constructor({ id, ward, availabilityStatus = 'Available', allocatedVisitId = null, dailyRate = 500 }) {
    this.id = id;
    this.ward = ward || 'General Ward';
    this.availabilityStatus = availabilityStatus;
    this.allocatedVisitId = allocatedVisitId;
    this.dailyRate = Number(dailyRate) || 500;
  }

  isAvailable() {
    return this.availabilityStatus === 'Available' && !this.allocatedVisitId;
  }

  allocate(visitId) {
    if (!this.isAvailable()) {
      throw new Error(`Bed ${this.id} in ${this.ward} is not available (Status: ${this.availabilityStatus}, Allocated to: ${this.allocatedVisitId}). Cannot double-allocate.`);
    }
    this.availabilityStatus = 'Occupied';
    this.allocatedVisitId = visitId;
  }

  release() {
    const previousVisitId = this.allocatedVisitId;
    this.availabilityStatus = 'Available';
    this.allocatedVisitId = null;
    return previousVisitId;
  }

  serialize() {
    return {
      id: this.id,
      ward: this.ward,
      availabilityStatus: this.availabilityStatus,
      allocatedVisitId: this.allocatedVisitId,
      dailyRate: this.dailyRate
    };
  }
}

class QueueEntry {
  constructor({
    id,
    patientVisitId,
    patientId = null,
    triagePriority = 3,
    queueEntryTimestamp = null,
    queueStatus = 'Waiting',
    calledTimestamp = null,
    assignedDoctorId = null
  }) {
    this.id = id;
    this.patientVisitId = patientVisitId;
    this.patientId = patientId;
    this.triagePriority = parseInt(triagePriority, 10) || 3;
    this.queueEntryTimestamp = queueEntryTimestamp || new Date().toISOString();
    this.queueStatus = queueStatus; // Waiting, Called, In Consultation, Completed, Removed, Missed
    this.calledTimestamp = calledTimestamp;
    this.assignedDoctorId = assignedDoctorId;
  }

  static compare(a, b) {
    if (a.triagePriority !== b.triagePriority) {
      return a.triagePriority - b.triagePriority;
    }
    const timeA = new Date(a.queueEntryTimestamp).getTime();
    const timeB = new Date(b.queueEntryTimestamp).getTime();
    return timeA - timeB;
  }

  markCalled(doctorId) {
    if (this.queueStatus !== 'Waiting') {
      throw new Error(`Cannot call queue entry ${this.id}: current status is '${this.queueStatus}', expected 'Waiting'.`);
    }
    this.queueStatus = 'Called';
    this.calledTimestamp = new Date().toISOString();
    this.assignedDoctorId = doctorId;
  }

  markInConsultation() {
    this.queueStatus = 'In Consultation';
  }

  markCompleted() {
    this.queueStatus = 'Completed';
  }

  markMissed() {
    this.queueStatus = 'Missed';
  }

  serialize() {
    return {
      id: this.id,
      patientVisitId: this.patientVisitId,
      patientId: this.patientId,
      triagePriority: this.triagePriority,
      queueEntryTimestamp: this.queueEntryTimestamp,
      queueStatus: this.queueStatus,
      calledTimestamp: this.calledTimestamp,
      assignedDoctorId: this.assignedDoctorId
    };
  }
}

/**
 * Subsystem: BedManager (Inpatient Bed Allocation & Management)
 */
class BedManager {
  constructor(db) {
    this.db = db;
  }

  async allocateBed(visitId, bedIdOrWard) {
    const beds = this.db.getBeds();
    let bed = null;

    if (bedIdOrWard && bedIdOrWard.startsWith('BED-')) {
      bed = beds.find(b => b.id === bedIdOrWard);
      if (!bed) {
        throw new Error(`Bed '${bedIdOrWard}' does not exist.`);
      }
    } else {
      // Find first available bed in specified ward, or any available bed
      const ward = bedIdOrWard || null;
      bed = beds.find(b => {
        const isAvail = b.availabilityStatus === 'Available' && !b.allocatedVisitId;
        return ward ? (isAvail && b.ward.toLowerCase() === ward.toLowerCase()) : isAvail;
      });
      if (!bed) {
        throw new Error(`No available beds found${ward ? ` in ward '${ward}'` : ''}.`);
      }
    }

    const bedInstance = new Bed(bed);
    bedInstance.allocate(visitId);
    await this.db.saveBed(bedInstance);
    return bedInstance;
  }

  async releaseBed(bedId) {
    const bed = this.db.getBedById(bedId);
    if (!bed) {
      throw new Error(`Bed '${bedId}' not found.`);
    }
    const bedInstance = new Bed(bed);
    const releasedVisitId = bedInstance.release();
    await this.db.saveBed(bedInstance);
    return { bed: bedInstance, releasedVisitId };
  }
}

/**
 * Subsystem 3: BillingSystem (Tariff Calculation & Invoicing Subsystem)
 */
class BillingSystem {
  constructor(db = null) {
    this.db = db;
    this.wardRates = {
      'ICU': 2500,
      'Emergency Ward': 1200,
      'Private Room': 1500,
      'General Ward': 500
    };
    this.consultationFee = 500;
    this.pharmacyBase = 350;
    this.insuranceSubsidyRate = 0.15; // 15% standard health subsidy
  }

  getWardDailyRate(wardName = 'General Ward') {
    if (!wardName) return 500;
    for (const [w, rate] of Object.entries(this.wardRates)) {
      if (wardName.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(wardName.toLowerCase())) {
        return rate;
      }
    }
    return 500;
  }

  calculateRoomTariff(wardName = 'General Ward', durationDays = 1) {
    const days = Math.max(1, parseInt(durationDays, 10) || 1);
    const dailyRate = this.getWardDailyRate(wardName);
    const roomTotal = dailyRate * days;
    return {
      ward: wardName,
      dailyRate,
      durationDays: days,
      roomTotal
    };
  }

  createOutpatientBill(visit, consultationFee = null) {
    const fee = consultationFee !== null ? consultationFee : this.consultationFee;
    const pharmacy = this.pharmacyBase;
    const subtotal = fee + pharmacy;
    const subsidy = Math.round(subtotal * this.insuranceSubsidyRate);
    const totalPayable = subtotal - subsidy;

    const invoiceId = `INV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const bill = {
      id: invoiceId,
      visitId: visit.id,
      patientId: visit.patientId,
      billType: 'Outpatient Consultation',
      issuedAt: new Date().toISOString(),
      status: 'Paid',
      paymentMethod: 'Cash / Health Card',
      items: [
        { description: 'Specialist Physician Consultation Fee', amount: fee, quantity: 1, total: fee },
        { description: 'Pharmacy & Medical Dispensary Baseline', amount: pharmacy, quantity: 1, total: pharmacy }
      ],
      subtotal,
      subsidyDiscount: subsidy,
      totalPayable,
      wardRate: 0,
      durationDays: 0,
      ward: null
    };

    return bill;
  }

  createAdmissionBill(visit, wardName = 'General Ward', durationDays = 3) {
    const roomCalc = this.calculateRoomTariff(wardName, durationDays);
    const fee = this.consultationFee;
    const pharmacy = this.pharmacyBase;
    const subtotal = fee + pharmacy + roomCalc.roomTotal;
    const subsidy = Math.round(subtotal * this.insuranceSubsidyRate);
    const totalPayable = subtotal - subsidy;

    const invoiceId = `INV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const bill = {
      id: invoiceId,
      visitId: visit.id,
      patientId: visit.patientId,
      billType: 'Inpatient Ward Admission',
      issuedAt: new Date().toISOString(),
      status: 'Pending Insurance Settlement',
      paymentMethod: 'Hospital Inpatient Account',
      items: [
        { description: `Inpatient Bed Tariff (${roomCalc.ward} @ ₹${roomCalc.dailyRate}/day)`, amount: roomCalc.dailyRate, quantity: roomCalc.durationDays, total: roomCalc.roomTotal },
        { description: 'Admission Consultation & Supervision Fee', amount: fee, quantity: 1, total: fee },
        { description: 'Inpatient Pharmacy & Dispensary Supplies', amount: pharmacy, quantity: 1, total: pharmacy }
      ],
      subtotal,
      subsidyDiscount: subsidy,
      totalPayable,
      wardRate: roomCalc.dailyRate,
      durationDays: roomCalc.durationDays,
      ward: roomCalc.ward
    };

    return bill;
  }
}

/**
 * Subsystem: DoctorScheduler
 */
class DoctorScheduler {
  constructor(db) {
    this.db = db;
  }

  async assignDoctor(doctorId, visitId) {
    const docData = this.db.getDoctorById(doctorId);
    if (!docData) {
      throw new Error(`Doctor '${doctorId}' does not exist.`);
    }
    const doctor = new Doctor(docData);
    doctor.assignVisit(visitId);
    await this.db.saveDoctor(doctor);
    return doctor;
  }

  async freeDoctor(doctorId) {
    if (!doctorId) return null;
    const docData = this.db.getDoctorById(doctorId);
    if (!docData) return null;
    const doctor = new Doctor(docData);
    doctor.releaseVisit();
    await this.db.saveDoctor(doctor);
    return doctor;
  }

  /**
   * Intelligently selects and allots the doctor from the matching clinical department
   * based on patient demographics, complaints, and vitals.
   */
  async autoAllotDoctor(patientData = {}, assessment = {}, visitId = null) {
    const doctors = this.db.getDoctors();
    const availableDocs = doctors.filter(d => d.availabilityStatus === 'Available');
    const pool = availableDocs.length > 0 ? availableDocs : doctors;

    // 0. Direct doctor ID match if specified
    if (assessment.assignedDoctorId) {
      const explicit = doctors.find(d => d.id === assessment.assignedDoctorId);
      if (explicit) return new Doctor(explicit);
    }

    // 0. Direct department match if specified
    if (assessment.department) {
      const deptDoc = pool.find(d => d.specialty.toLowerCase().includes(assessment.department.toLowerCase())) ||
                      doctors.find(d => d.specialty.toLowerCase().includes(assessment.department.toLowerCase()));
      if (deptDoc) return new Doctor(deptDoc);
    }

    const age = parseInt(patientData.age, 10);
    const complaint = String(assessment.chiefComplaint || '').toLowerCase();
    const category = String(assessment.triageCategory || '').toLowerCase();
    const spo2 = parseInt(assessment.oxygenSaturation, 10);
    const hr = parseInt(assessment.heartRate, 10);
    const bp = String(assessment.bloodPressure || '').trim();

    let targetSpecialty = 'General Medicine';

    // 1. Pediatric Department (Age < 18 or pediatric complaints)
    if ((!isNaN(age) && age < 18) || complaint.includes('child') || complaint.includes('pediatric') || complaint.includes('infant') || complaint.includes('baby')) {
      targetSpecialty = 'Pediatrics';
    }
    // 2. Cardiology Department
    else if (
      complaint.includes('chest') ||
      complaint.includes('heart') ||
      complaint.includes('cardiac') ||
      complaint.includes('angina') ||
      complaint.includes('palpitat') ||
      (!isNaN(hr) && hr >= 125) ||
      (bp.includes('/') && parseInt(bp.split('/')[0], 10) >= 170)
    ) {
      targetSpecialty = 'Cardiology';
    }
    // 3. Pulmonology / Respiratory Department
    else if (
      complaint.includes('asthma') ||
      complaint.includes('breath') ||
      complaint.includes('wheez') ||
      complaint.includes('lung') ||
      complaint.includes('respirat') ||
      complaint.includes('cough') ||
      (!isNaN(spo2) && spo2 < 92)
    ) {
      targetSpecialty = 'Pulmonology';
    }
    // 4. Orthopedics Department
    else if (
      complaint.includes('fracture') ||
      complaint.includes('bone') ||
      complaint.includes('joint') ||
      complaint.includes('sprain') ||
      complaint.includes('dislocat') ||
      complaint.includes('back pain') ||
      complaint.includes('spine')
    ) {
      targetSpecialty = 'Orthopedics';
    }
    // 5. Trauma & Surgery
    else if (
      complaint.includes('trauma') ||
      complaint.includes('accident') ||
      complaint.includes('bleed') ||
      complaint.includes('burn') ||
      complaint.includes('cut') ||
      complaint.includes('wound') ||
      complaint.includes('lacerat')
    ) {
      targetSpecialty = 'Trauma & Surgery';
    }
    // 6. Neurology Department
    else if (
      complaint.includes('headache') ||
      complaint.includes('stroke') ||
      complaint.includes('seizure') ||
      complaint.includes('dizz') ||
      complaint.includes('faint') ||
      complaint.includes('neuro') ||
      complaint.includes('migraine') ||
      complaint.includes('paralys')
    ) {
      targetSpecialty = 'Neurology';
    }
    // 7. Internal Medicine Department
    else if (
      complaint.includes('fever') ||
      complaint.includes('diabet') ||
      complaint.includes('stomach') ||
      complaint.includes('abdom') ||
      complaint.includes('infect') ||
      complaint.includes('kidney') ||
      complaint.includes('vomit')
    ) {
      targetSpecialty = 'Internal Medicine';
    }
    // 8. Emergency Medicine (Priority 1 general emergencies)
    else if (category === 'emergency' || category === 'priority 1' || complaint.includes('unconscious') || complaint.includes('collapse')) {
      targetSpecialty = 'Emergency Medicine';
    }

    // Match doctor by specialty
    let matchedDoc = pool.find(d => d.specialty.toLowerCase().includes(targetSpecialty.toLowerCase()));

    // Fallbacks if target doctor not found in pool
    if (!matchedDoc) {
      matchedDoc = doctors.find(d => d.specialty.toLowerCase().includes(targetSpecialty.toLowerCase()));
    }
    if (!matchedDoc && targetSpecialty === 'Pulmonology') {
      matchedDoc = pool.find(d => d.specialty === 'Emergency Medicine') || pool.find(d => d.specialty === 'Internal Medicine');
    }
    if (!matchedDoc && targetSpecialty === 'Orthopedics') {
      matchedDoc = pool.find(d => d.specialty === 'Trauma & Surgery');
    }
    if (!matchedDoc) {
      matchedDoc = pool.find(d => d.specialty === 'General Medicine') || pool[0] || doctors[0];
    }

    return matchedDoc ? new Doctor(matchedDoc) : null;
  }
}

/**
 * ============================================================================
 * GOF DESIGN PATTERN: FAÇADE PATTERN (Structural Pattern)
 * ============================================================================
 * Intent:
 *   "Provide a unified interface to a set of interfaces in a subsystem.
 *    Façade defines a higher-level interface that makes the subsystem easier to use."
 * 
 * Clinical Features Built Using This Façade:
 *   1. Feature: Patient Registration & Visit Intake (`registerPatient`, `createVisit`)
 *   2. Feature: Automated Vitals Triage & Priority Queuing (`performTriage`, `getPriorityQueue`)
 *      -> Coordinates Subsystem: TriageFactory (Factory Method)
 *   3. Feature: Multi-Department Specialist Allotment (`doctorScheduler`, `autoAllotDoctor`)
 *      -> Coordinates Subsystem: DoctorScheduler (Roster & Availability)
 *   4. Feature: Consultation Lifecycle Coordination (`callNextPatient`, `startConsultation`, `completeVisit`)
 *      -> Coordinates Subsystem: StateFactory (State Pattern)
 *   5. Feature: Inpatient Bed & Ward Management (`admitPatient`, `bedManager`)
 *      -> Coordinates Subsystem: BedManager (Physical Bed Allocation)
 *   6. Feature: Persistence & Real-time Audit Logs (`db`)
 *      -> Coordinates Subsystem: DatabaseEngine (Atomic JSON Storage)
 * ============================================================================
 */
class HospitalQueueFacade {
  constructor(db = null) {
    this.db = db || DatabaseEngine.getInstance();
    this.bedManager = new BedManager(this.db);
    this.doctorScheduler = new DoctorScheduler(this.db);
    this.billing = new BillingSystem(this.db);
  }

  /**
   * 1. Register a new patient or retrieve existing
   */
  async registerPatient(patientData) {
    const validation = Patient.validate(patientData);
    if (!validation.isValid) {
      throw new Error(`Patient Registration Failed: ${validation.errors.join(' ')}`);
    }

    // Check if patient already exists by ID or exact contact
    if (patientData.id) {
      const existing = this.db.getPatientById(patientData.id);
      if (existing) {
        return existing;
      }
    }

    const patientId = patientData.id || `PAT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const patient = new Patient({
      ...patientData,
      id: patientId
    });

    await this.db.savePatient(patient);
    return patient.serialize();
  }

  /**
   * 2. Create a new hospital visit for a patient
   */
  async createVisit(patientId, visitDetails = {}) {
    const patient = this.db.getPatientById(patientId);
    if (!patient) {
      throw new Error(`Cannot create visit: Patient '${patientId}' was not found.`);
    }

    const visitId = visitDetails.id || `VIS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const visit = new PatientVisit({
      id: visitId,
      patientId,
      registrationTimestamp: new Date().toISOString(),
      currentState: 'Registered'
    });

    // Advance from Registered to Awaiting Triage
    StateFactory.transition(visit, 'await_triage', {
      note: visitDetails.reason ? `Reason: ${visitDetails.reason}` : 'Initial triage queue.'
    });

    await this.db.saveVisit(visit);
    return visit.serialize();
  }

  /**
   * 3. Complete clinical triage via Factory Pattern and advance visit state
   */
  async completeTriage(visitId, triageData, staffId = 'STAFF-TRIAGE') {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }

    const visit = new PatientVisit(visitData);

    // Guard: Prevent duplicate active queue entries
    const existingQueue = this.db.getQueueEntryByVisitId(visitId);
    if (existingQueue) {
      throw new Error(`Visit '${visitId}' already has an active queue entry (${existingQueue.id}). Duplicate queue entries are prevented.`);
    }

    // 1. Invoke Factory Pattern for TriageAssessment (Auto vitals assessment or explicit category)
    const hasVitals = triageData.oxygenSaturation || triageData.heartRate || triageData.bloodPressure || triageData.respiratoryRate;
    const assessment = (!triageData.triageCategory && hasVitals)
      ? TriageFactory.createFromVitals({
          ...triageData,
          visitId,
          assessedByStaffId: staffId
        })
      : TriageFactory.createAssessment({
          ...triageData,
          visitId,
          assessedByStaffId: staffId
        });

    // 2. Invoke State Pattern on PatientVisit
    const priority = assessment.getPriorityLevel();
    const isEmergency = priority === 1;

    StateFactory.transition(visit, 'complete_triage', {
      assessmentId: assessment.id,
      category: assessment.triageCategory,
      isEmergency,
      note: `Triage complete. Category: ${assessment.triageCategory} (Priority ${priority}). Severity: ${assessment.severityScore}.`
    });

    // 3. Automatically Allot Matching Specialist Doctor from Department
    const patientData = this.db.getPatientById(visit.patientId) || {};
    let allottedDoctor = null;
    try {
      allottedDoctor = await this.doctorScheduler.autoAllotDoctor(patientData, {
        ...assessment,
        assignedDoctorId: triageData.assignedDoctorId,
        department: triageData.department
      }, visit.id);
    } catch (_) {}

    if (allottedDoctor) {
      visit.assignedDoctorId = allottedDoctor.id;
    }

    // 4. Create QueueEntry with allotted doctor
    const queueEntryId = `Q-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const queueEntry = new QueueEntry({
      id: queueEntryId,
      patientVisitId: visit.id,
      patientId: visit.patientId,
      triagePriority: priority,
      queueStatus: 'Waiting',
      assignedDoctorId: allottedDoctor ? allottedDoctor.id : null
    });

    visit.queueEntryId = queueEntryId;

    // Save all atomically
    await this.db.saveAssessment(assessment);
    await this.db.saveQueueEntry(queueEntry);
    await this.db.saveVisit(visit);

    return {
      success: true,
      assessment: assessment.serialize(),
      queueEntry: queueEntry.serialize(),
      visit: visit.serialize()
    };
  }

  /**
   * 4. Retrieve priority queue ordered by clinical priority and wait time
   */
  async getPriorityQueue(filters = {}) {
    const activeEntries = this.db.getActiveQueueEntries();

    // Sort using QueueEntry priority comparison
    activeEntries.sort(QueueEntry.compare);

    // Hydrate with patient and visit info
    return activeEntries.map(entry => {
      const visit = this.db.getVisitById(entry.patientVisitId);
      const patient = visit ? this.db.getPatientById(visit.patientId) : null;
      const assessment = visit && visit.triageAssessmentId ? this.db.getAssessmentById(visit.triageAssessmentId) : null;
      const docId = entry.assignedDoctorId || (visit ? visit.assignedDoctorId : null);
      const doctor = docId ? this.db.getDoctorById(docId) : null;

      // Calculate wait duration in minutes
      const waitMinutes = Math.max(0, Math.floor((Date.now() - new Date(entry.queueEntryTimestamp).getTime()) / 60000));

      return {
        ...entry,
        waitMinutes,
        patientName: patient ? patient.name : 'Unknown Patient',
        patientAge: patient ? patient.age : 'N/A',
        chiefComplaint: assessment ? assessment.chiefComplaint : 'N/A',
        triageCategory: assessment ? assessment.triageCategory : 'Standard',
        severityScore: assessment ? assessment.severityScore : 1,
        clinicalAlerts: assessment ? assessment.clinicalAlerts : [],
        assignedDoctorName: doctor ? `${doctor.name} (${doctor.specialty})` : null,
        currentState: visit ? visit.currentState : 'Unknown'
      };
    });
  }

  /**
   * 5. Call next eligible patient
   */
  async callNextPatient(doctorId, options = {}) {
    const doctorData = this.db.getDoctorById(doctorId);
    if (!doctorData) {
      throw new Error(`Doctor '${doctorId}' not found.`);
    }
    const doctor = new Doctor(doctorData);
    if (!doctor.canAcceptConsultation()) {
      throw new Error(`Doctor ${doctor.name} is currently ${doctor.availabilityStatus} and cannot call the next patient.`);
    }

    // Get sorted priority queue
    const activeQueue = await this.getPriorityQueue();
    const waitingPatients = activeQueue.filter(q => q.queueStatus === 'Waiting');

    if (waitingPatients.length === 0) {
      return { success: false, message: 'No patients currently waiting in queue.' };
    }

    // Highest priority patient is the first one
    const targetEntry = options.visitId
      ? waitingPatients.find(q => q.patientVisitId === options.visitId) || waitingPatients[0]
      : waitingPatients[0];

    const visitData = this.db.getVisitById(targetEntry.patientVisitId);
    const visit = new PatientVisit(visitData);
    const queueData = this.db.getQueueEntryById(targetEntry.id);
    const queueEntry = new QueueEntry(queueData);

    // Transition via State Pattern: Waiting -> Called
    StateFactory.transition(visit, 'call_patient', {
      doctorId: doctor.id,
      doctorName: doctor.name
    });

    // Update queue entry
    queueEntry.markCalled(doctor.id);

    // Save changes
    await this.db.saveQueueEntry(queueEntry);
    await this.db.saveVisit(visit);

    return {
      success: true,
      calledPatient: {
        queueEntryId: queueEntry.id,
        visitId: visit.id,
        patientName: targetEntry.patientName,
        triagePriority: queueEntry.triagePriority,
        triageCategory: targetEntry.triageCategory,
        doctor: doctor.serialize(),
        calledTimestamp: queueEntry.calledTimestamp
      }
    };
  }

  /**
   * Requeue patient (missed call policy)
   */
  async requeuePatient(visitId, reason = 'Patient missed call') {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }
    const visit = new PatientVisit(visitData);

    // Must be in Called state
    StateFactory.transition(visit, 'requeue', { note: reason });

    const queueEntryData = this.db.getQueueEntryByVisitId(visitId);
    if (queueEntryData) {
      const queueEntry = new QueueEntry(queueEntryData);
      queueEntry.queueStatus = 'Waiting';
      queueEntry.calledTimestamp = null;
      queueEntry.assignedDoctorId = null;
      await this.db.saveQueueEntry(queueEntry);
    }

    if (visit.assignedDoctorId) {
      await this.doctorScheduler.freeDoctor(visit.assignedDoctorId);
      visit.assignedDoctorId = null;
    }

    await this.db.saveVisit(visit);
    return { success: true, message: 'Patient re-queued to waiting queue.', visit: visit.serialize() };
  }

  /**
   * 6. Start Consultation
   */
  async startConsultation(visitId, doctorId) {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }
    const visit = new PatientVisit(visitData);

    const docId = doctorId || visit.assignedDoctorId;
    if (!docId) {
      throw new Error('A doctor ID is required to start consultation.');
    }

    const doctor = await this.doctorScheduler.assignDoctor(docId, visit.id);

    // Transition via State Pattern
    StateFactory.transition(visit, 'start_consultation', {
      doctorId: doctor.id,
      doctorName: doctor.name
    });

    const queueEntryData = this.db.getQueueEntryByVisitId(visitId);
    if (queueEntryData) {
      const queueEntry = new QueueEntry(queueEntryData);
      queueEntry.markInConsultation();
      queueEntry.assignedDoctorId = doctor.id;
      await this.db.saveQueueEntry(queueEntry);
    }

    await this.db.saveVisit(visit);
    return {
      success: true,
      visit: visit.serialize(),
      doctor: doctor.serialize()
    };
  }

  /**
   * 7. Complete Visit (Outpatient resolution)
   */
  async completeVisit(visitId, consultationNotes = '') {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }
    const visit = new PatientVisit(visitData);

    // Transition via State Pattern to Completed
    StateFactory.transition(visit, 'complete', {
      notes: consultationNotes,
      note: 'Consultation concluded; patient discharged with outpatient prescription.'
    });

    // Release doctor
    if (visit.assignedDoctorId) {
      await this.doctorScheduler.freeDoctor(visit.assignedDoctorId);
    }

    // Update queue entry
    const queueEntryData = this.db.getQueueEntryByVisitId(visitId);
    if (queueEntryData) {
      const queueEntry = new QueueEntry(queueEntryData);
      queueEntry.markCompleted();
      await this.db.saveQueueEntry(queueEntry);
    }

    // Subsystem 3: Generate Outpatient Bill
    let bill = null;
    try {
      bill = this.billing.createOutpatientBill(visit);
      visit.billingSummary = {
        invoiceId: bill.id,
        subtotal: bill.subtotal,
        subsidyDiscount: bill.subsidyDiscount,
        totalPayable: bill.totalPayable,
        status: bill.status
      };
      await this.db.saveBill(bill);
    } catch (e) {
      console.error('[HospitalQueueFacade] Billing generation error:', e);
    }

    await this.db.saveVisit(visit);
    return {
      success: true,
      outcome: 'Completed',
      visit: visit.serialize(),
      bill
    };
  }

  /**
   * 8. Admit Patient (Inpatient admission to bed)
   */
  async admitPatient(visitId, bedIdOrWard, admissionDetails = {}) {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }
    const visit = new PatientVisit(visitData);

    // Step 1: Allocate physical bed via BedManager
    let allocatedBed;
    try {
      allocatedBed = await this.bedManager.allocateBed(visit.id, bedIdOrWard);
    } catch (err) {
      throw new Error(`Admission Aborted: ${err.message}`);
    }

    // Step 2: Transition via State Pattern to Admitted
    try {
      StateFactory.transition(visit, 'admit', {
        bedId: allocatedBed.id,
        ward: allocatedBed.ward,
        notes: admissionDetails.notes || visit.consultationNotes
      });
    } catch (err) {
      // Rollback bed allocation if state transition fails
      await this.bedManager.releaseBed(allocatedBed.id);
      throw err;
    }

    // Release doctor from outpatient consultation duty
    if (visit.assignedDoctorId) {
      await this.doctorScheduler.freeDoctor(visit.assignedDoctorId);
    }

    // Mark queue entry completed
    const queueEntryData = this.db.getQueueEntryByVisitId(visitId);
    if (queueEntryData) {
      const queueEntry = new QueueEntry(queueEntryData);
      queueEntry.markCompleted();
      await this.db.saveQueueEntry(queueEntry);
    }

    // Subsystem 3: Generate Inpatient Admission Bill
    let bill = null;
    try {
      const durationDays = admissionDetails.durationDays ? parseInt(admissionDetails.durationDays, 10) : 3;
      bill = this.billing.createAdmissionBill(visit, allocatedBed.ward, durationDays);
      visit.billingSummary = {
        invoiceId: bill.id,
        subtotal: bill.subtotal,
        subsidyDiscount: bill.subsidyDiscount,
        totalPayable: bill.totalPayable,
        status: bill.status,
        durationDays,
        ward: allocatedBed.ward
      };
      await this.db.saveBill(bill);
    } catch (e) {
      console.error('[HospitalQueueFacade] Admission billing error:', e);
    }

    await this.db.saveVisit(visit);
    return {
      success: true,
      outcome: 'Admitted',
      bed: allocatedBed.serialize(),
      visit: visit.serialize(),
      bill
    };
  }

  /**
   * 9. Refer Patient to specialized external facility
   */
  async referPatient(visitId, referralDetails = {}) {
    const visitData = this.db.getVisitById(visitId);
    if (!visitData) {
      throw new Error(`Visit '${visitId}' not found.`);
    }
    const visit = new PatientVisit(visitData);

    // Transition via State Pattern to Referred
    StateFactory.transition(visit, 'refer', {
      referralFacility: referralDetails.facility || referralDetails.referralFacility || 'City Tertiary Medical Center',
      reason: referralDetails.reason || 'Advanced diagnostic evaluation and surgical intervention.',
      notes: referralDetails.notes || visit.consultationNotes
    });

    // Release doctor
    if (visit.assignedDoctorId) {
      await this.doctorScheduler.freeDoctor(visit.assignedDoctorId);
    }

    // Mark queue entry completed
    const queueEntryData = this.db.getQueueEntryByVisitId(visitId);
    if (queueEntryData) {
      const queueEntry = new QueueEntry(queueEntryData);
      queueEntry.markCompleted();
      await this.db.saveQueueEntry(queueEntry);
    }

    await this.db.saveVisit(visit);
    return {
      success: true,
      outcome: 'Referred',
      referralDetails: visit.referralDetails,
      visit: visit.serialize()
    };
  }

  /**
   * Release Bed helper
   */
  async releaseBed(bedId) {
    return await this.bedManager.releaseBed(bedId);
  }

  /**
   * System Dashboard Statistics
   */
  async getDashboardStats() {
    const visits = this.db.getVisits();
    const activeQueue = await this.getPriorityQueue();
    const doctors = this.db.getDoctors();
    const beds = this.db.getBeds();

    const awaitingTriage = visits.filter(v => v.currentState === 'Awaiting Triage' || v.currentState === 'Registered').length;
    const waitingConsultation = activeQueue.filter(q => q.queueStatus === 'Waiting').length;
    const inConsultation = visits.filter(v => v.currentState === 'In Consultation').length;
    const emergencyPriority1 = activeQueue.filter(q => q.triagePriority === 1 && (q.queueStatus === 'Waiting' || q.queueStatus === 'Called')).length;
    const availableDoctors = doctors.filter(d => d.availabilityStatus === 'Available').length;
    const availableBeds = beds.filter(b => b.availabilityStatus === 'Available').length;
    const admittedCount = visits.filter(v => v.currentState === 'Admitted').length;
    const completedToday = visits.filter(v => v.currentState === 'Completed').length;

    return {
      totalVisits: visits.length,
      activeVisits: awaitingTriage + waitingConsultation + inConsultation,
      awaitingTriage,
      waitingConsultation,
      inConsultation,
      emergencyPriority1,
      availableDoctors,
      totalDoctors: doctors.length,
      availableBeds,
      totalBeds: beds.length,
      admittedCount,
      completedToday
    };
  }

  /**
   * Billing & Tariff Subsystem Methods
   */
  getBills() {
    return this.db.getBills();
  }

  getBillByVisitId(visitId) {
    return this.db.getBillByVisitId(visitId);
  }

  getBillById(id) {
    return this.db.getBillById(id);
  }
}

/**
 * ========================================================
 * PDF PATTERN SPECIFICATION: AdmissionFacade
 * Source Package: server/patterns/facade.js (Pages 1-4)
 * ========================================================
 */
class AdmissionFacade {
  constructor(db = null) {
    this.db = db || DatabaseEngine.getInstance();
    this.bedManager = new BedManager(this.db);
    this.scheduler = new DoctorScheduler(this.db);
    this.billing = new BillingSystem(this.db);
  }

  async admitPatient(patientOrVisit, bedCategory = 'General Ward') {
    const pId = typeof patientOrVisit === 'string' ? patientOrVisit : (patientOrVisit.id || patientOrVisit.patientId);
    let patient = this.db.getPatientById(pId) || (typeof patientOrVisit === 'object' ? patientOrVisit : { id: pId });

    const allocatedBed = await this.bedManager.allocateBed(patient.id, bedCategory);
    patient.bedNumber = allocatedBed.id;

    const availableDoctors = this.db.getDoctors().filter(d => d.availabilityStatus === 'Available');
    const doctor = availableDoctors.length > 0
      ? await this.scheduler.assignDoctor(availableDoctors[0].id, patient.id)
      : { name: 'Dr. Supervising Staff' };
    patient.assignedDoctor = doctor.name;

    try {
      const currentState = StateFactory.getState(patient.stateName || 'Waiting');
      currentState.next(patient, 'admit', { bedId: allocatedBed.id, ward: allocatedBed.ward });
    } catch (_) {
      patient.stateName = 'Admitted';
    }

    patient.logs = patient.logs || [];
    patient.logs.push(`[AdmissionFacade] Admitted to Bed ${allocatedBed.id} (${bedCategory}) under ${doctor.name}.`);

    if (patient.id && this.db.getPatientById(patient.id)) {
      await this.db.savePatient(patient);
    }

    return {
      success: true,
      patient,
      bed: allocatedBed.serialize ? allocatedBed.serialize() : allocatedBed
    };
  }

  async dischargePatient(patientOrVisit) {
    const pId = typeof patientOrVisit === 'string' ? patientOrVisit : (patientOrVisit.id || patientOrVisit.patientId);
    let patient = this.db.getPatientById(pId) || (typeof patientOrVisit === 'object' ? patientOrVisit : { id: pId });

    if (patient.stateName && patient.stateName !== 'Admitted') {
      throw new Error(`Cannot discharge patient in '${patient.stateName}' state.`);
    }

    let freedBed = null;
    if (patient.bedNumber) {
      const rel = await this.bedManager.releaseBed(patient.bedNumber);
      freedBed = rel.bed ? rel.bed.id : patient.bedNumber;
    }

    if (patient.assignedDoctor) {
      await this.scheduler.freeDoctor(patient.assignedDoctor);
    }

    try {
      const currentState = StateFactory.getState(patient.stateName || 'Admitted');
      currentState.next(patient, 'discharge');
    } catch (_) {
      patient.stateName = 'Discharged';
    }

    patient.logs = patient.logs || [];
    patient.logs.push(`[AdmissionFacade] Discharged. Bed ${freedBed || 'released'} freed.`);

    if (patient.id && this.db.getPatientById(patient.id)) {
      await this.db.savePatient(patient);
    }

    return {
      success: true,
      patient,
      freedBed
    };
  }
}

HospitalQueueFacade.AdmissionFacade = AdmissionFacade;
HospitalQueueFacade.BedManager = BedManager;
HospitalQueueFacade.DoctorScheduler = DoctorScheduler;
HospitalQueueFacade.BillingSystem = BillingSystem;
HospitalQueueFacade.Patient = Patient;
HospitalQueueFacade.Doctor = Doctor;
HospitalQueueFacade.Bed = Bed;
HospitalQueueFacade.QueueEntry = QueueEntry;

module.exports = HospitalQueueFacade;
module.exports.HospitalQueueFacade = HospitalQueueFacade;
module.exports.AdmissionFacade = AdmissionFacade;
module.exports.BedManager = BedManager;
module.exports.DoctorScheduler = DoctorScheduler;
module.exports.BillingSystem = BillingSystem;
module.exports.Patient = Patient;
module.exports.Doctor = Doctor;
module.exports.Bed = Bed;
module.exports.QueueEntry = QueueEntry;
