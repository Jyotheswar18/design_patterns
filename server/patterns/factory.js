/**
 * ============================================================================
 * GOF DESIGN PATTERN: FACTORY METHOD PATTERN (Creational Pattern)
 * ============================================================================
 * Intent:
 *   "Define an interface for creating an object, but let subclasses decide
 *    which class to instantiate. Factory Method lets a class defer
 *    instantiation to subclasses."
 * 
 * Application Feature Built Using This Pattern:
 *   FEATURE: AUTOMATED CLINICAL TRIAGE & ACUITY CLASSIFICATION
 *   - When patient vitals are recorded during registration/triage:
 *     (Heart Rate, SpO2, Blood Pressure, Respiratory Rate, Temperature)
 *   - `TriageFactory.createFromVitals(inputData)` evaluates physiological rules
 *     and dynamically instantiates the matching concrete assessment product:
 *       1. EmergencyAssessment  -> Priority Level 1 (Immediate, Severity 7-10)
 *       2. UrgentAssessment     -> Priority Level 2 (Urgent care, Severity 5-6)
 *       3. StandardAssessment   -> Priority Level 3 (Routine OPD, Severity 3-4)
 *       4. NonUrgentAssessment  -> Priority Level 4 (Minor / Follow-up, Severity 1-2)
 * 
 * Participants:
 *   - Creator: TriageFactory (`createFromVitals`, `createAssessment`)
 *   - Abstract Product: TriageAssessment (base class with validation and priority)
 *   - Concrete Products: EmergencyAssessment, UrgentAssessment, StandardAssessment, NonUrgentAssessment
 * ============================================================================
 */
/**
 * ----------------------------------------------------------------------------
 * 1. GOF ABSTRACT PRODUCT: TriageAssessment
 * Base product defining common fields, vitals validation, and clinical alerts.
 * ----------------------------------------------------------------------------
 */
class TriageAssessment {
  constructor({
    id,
    visitId,
    chiefComplaint,
    symptoms = [],
    temperature = null,
    heartRate = null,
    bloodPressure = null,
    respiratoryRate = null,
    oxygenSaturation = null,
    triageCategory,
    severityScore = 1,
    clinicalNotes = '',
    assessedByStaffId = 'STAFF-TRIAGE',
    assessmentTimestamp = null
  }) {
    this.id = id;
    this.visitId = visitId;
    this.chiefComplaint = chiefComplaint;
    this.symptoms = Array.isArray(symptoms) ? symptoms : (typeof symptoms === 'string' ? symptoms.split(',').map(s => s.trim()).filter(Boolean) : []);
    this.temperature = temperature !== null && temperature !== undefined && temperature !== '' ? parseFloat(temperature) : null;
    this.heartRate = heartRate !== null && heartRate !== undefined && heartRate !== '' ? parseInt(heartRate, 10) : null;
    this.bloodPressure = bloodPressure ? String(bloodPressure).trim() : null;
    this.respiratoryRate = respiratoryRate !== null && respiratoryRate !== undefined && respiratoryRate !== '' ? parseInt(respiratoryRate, 10) : null;
    this.oxygenSaturation = oxygenSaturation !== null && oxygenSaturation !== undefined && oxygenSaturation !== '' ? parseInt(oxygenSaturation, 10) : null;
    this.triageCategory = triageCategory;
    this.severityScore = parseInt(severityScore, 10) || 1;
    this.clinicalNotes = clinicalNotes || '';
    this.assessedByStaffId = assessedByStaffId || 'STAFF-TRIAGE';
    this.assessmentTimestamp = assessmentTimestamp || new Date().toISOString();
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 1.5: Physiological Data Validation
   * Rejects out-of-bounds vitals to protect clinical database integrity.
   * --------------------------------------------------------------------------
   */
  static validate(data) {
    const errors = [];
    if (!data.visitId) {
      errors.push('Visit ID is required for triage assessment.');
    }
    if (!data.chiefComplaint || typeof data.chiefComplaint !== 'string' || data.chiefComplaint.trim().length === 0) {
      errors.push('Chief complaint is required.');
    }
    if (!data.triageCategory) {
      errors.push('Staff-assigned triage category is required.');
    }

    if (data.temperature !== null && data.temperature !== undefined && data.temperature !== '') {
      const temp = parseFloat(data.temperature);
      if (isNaN(temp) || temp < 25 || temp > 45) {
        errors.push('Recorded temperature must be within physiological range (25.0 - 45.0 °C).');
      }
    }

    if (data.heartRate !== null && data.heartRate !== undefined && data.heartRate !== '') {
      const hr = parseInt(data.heartRate, 10);
      if (isNaN(hr) || hr < 20 || hr > 260) {
        errors.push('Recorded heart rate must be within physiological range (20 - 260 bpm).');
      }
    }

    if (data.respiratoryRate !== null && data.respiratoryRate !== undefined && data.respiratoryRate !== '') {
      const rr = parseInt(data.respiratoryRate, 10);
      if (isNaN(rr) || rr < 4 || rr > 70) {
        errors.push('Recorded respiratory rate must be within physiological range (4 - 70 breaths/min).');
      }
    }

    if (data.oxygenSaturation !== null && data.oxygenSaturation !== undefined && data.oxygenSaturation !== '') {
      const spo2 = parseInt(data.oxygenSaturation, 10);
      if (isNaN(spo2) || spo2 < 40 || spo2 > 100) {
        errors.push('Recorded oxygen saturation must be within 40% - 100%.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 1.3: Priority Queue Ranking Determination
   * Maps triage category to integer priority (1=Emergency ... 4=Non-Urgent).
   * --------------------------------------------------------------------------
   */
  getPriorityLevel() {
    switch (this.triageCategory) {
      case 'Emergency':
        return 1;
      case 'Urgent':
        return 2;
      case 'Standard':
        return 3;
      case 'Non-Urgent':
      case 'Follow-up':
        return 4;
      default:
        return 3;
    }
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 1.4: Real-Time Clinical Alerts Generation
   * Generates urgent warning flags displayed on doctor & nurse dashboards.
   * --------------------------------------------------------------------------
   */
  getClinicalAlerts() {
    const alerts = [];
    if (this.oxygenSaturation !== null && this.oxygenSaturation < 92) {
      alerts.push(`Critical SpO2: ${this.oxygenSaturation}% is below safe oxygenation threshold (92%).`);
    }
    if (this.heartRate !== null && (this.heartRate > 120 || this.heartRate < 50)) {
      alerts.push(`Abnormal Heart Rate: ${this.heartRate} bpm.`);
    }
    if (this.temperature !== null && (this.temperature > 39.0 || this.temperature < 35.0)) {
      alerts.push(`Critical Body Temperature: ${this.temperature}°C.`);
    }
    if (this.bloodPressure) {
      const parts = this.bloodPressure.split('/');
      if (parts.length === 2) {
        const sys = parseInt(parts[0], 10);
        const dia = parseInt(parts[1], 10);
        if (sys >= 180 || dia >= 110) {
          alerts.push(`Hypertensive Crisis Alert: ${this.bloodPressure} mmHg.`);
        } else if (sys <= 85) {
          alerts.push(`Hypotension Warning: Systolic ${sys} mmHg.`);
        }
      }
    }
    return alerts;
  }

  serialize() {
    return {
      id: this.id,
      visitId: this.visitId,
      chiefComplaint: this.chiefComplaint,
      symptoms: this.symptoms,
      temperature: this.temperature,
      heartRate: this.heartRate,
      bloodPressure: this.bloodPressure,
      respiratoryRate: this.respiratoryRate,
      oxygenSaturation: this.oxygenSaturation,
      triageCategory: this.triageCategory,
      severityScore: this.severityScore,
      priorityLevel: this.getPriorityLevel(),
      clinicalAlerts: this.getClinicalAlerts(),
      clinicalNotes: this.clinicalNotes,
      assessedByStaffId: this.assessedByStaffId,
      assessmentTimestamp: this.assessmentTimestamp
    };
  }
}

/**
 * ----------------------------------------------------------------------------
 * FEATURE 1.2: Acuity & Priority Classification Products
 * Concrete product hierarchy encapsulating specific urgency rules and matching logic.
 * ----------------------------------------------------------------------------
 */
class EmergencyAssessment extends TriageAssessment {
  constructor(data) {
    super({ ...data, triageCategory: 'Emergency', severityScore: Math.max(7, parseInt(data.severityScore, 10) || 7) });
  }

  getPriorityLevel() {
    return 1;
  }

  static matchesVitals(v = {}) {
    const spo2 = v.oxygenSaturation !== null && v.oxygenSaturation !== undefined && v.oxygenSaturation !== '' ? parseInt(v.oxygenSaturation, 10) : null;
    const hr = v.heartRate !== null && v.heartRate !== undefined && v.heartRate !== '' ? parseInt(v.heartRate, 10) : null;
    const rr = v.respiratoryRate !== null && v.respiratoryRate !== undefined && v.respiratoryRate !== '' ? parseInt(v.respiratoryRate, 10) : null;
    const temp = v.temperature !== null && v.temperature !== undefined && v.temperature !== '' ? parseFloat(v.temperature) : null;
    let sys = null;
    if (v.bloodPressure && String(v.bloodPressure).includes('/')) {
      sys = parseInt(String(v.bloodPressure).split('/')[0], 10);
    }
    return (spo2 !== null && spo2 < 90) ||
           (hr !== null && (hr > 130 || hr < 40)) ||
           (sys !== null && (sys >= 180 || sys < 80)) ||
           (rr !== null && (rr > 30 || rr < 8)) ||
           (temp !== null && (temp >= 40.0 || temp <= 35.0));
  }
}

class UrgentAssessment extends TriageAssessment {
  constructor(data) {
    super({ ...data, triageCategory: 'Urgent', severityScore: Math.max(5, Math.min(6, parseInt(data.severityScore, 10) || 5)) });
  }

  getPriorityLevel() {
    return 2;
  }

  static matchesVitals(v = {}) {
    const spo2 = v.oxygenSaturation !== null && v.oxygenSaturation !== undefined && v.oxygenSaturation !== '' ? parseInt(v.oxygenSaturation, 10) : null;
    const hr = v.heartRate !== null && v.heartRate !== undefined && v.heartRate !== '' ? parseInt(v.heartRate, 10) : null;
    const rr = v.respiratoryRate !== null && v.respiratoryRate !== undefined && v.respiratoryRate !== '' ? parseInt(v.respiratoryRate, 10) : null;
    const temp = v.temperature !== null && v.temperature !== undefined && v.temperature !== '' ? parseFloat(v.temperature) : null;
    let sys = null;
    if (v.bloodPressure && String(v.bloodPressure).includes('/')) {
      sys = parseInt(String(v.bloodPressure).split('/')[0], 10);
    }
    return (spo2 !== null && spo2 < 94) ||
           (hr !== null && (hr > 110 || hr < 50)) ||
           (sys !== null && sys >= 140) ||
           (rr !== null && rr >= 24) ||
           (temp !== null && temp >= 38.5);
  }
}

class StandardAssessment extends TriageAssessment {
  constructor(data) {
    super({ ...data, triageCategory: 'Standard', severityScore: Math.max(3, Math.min(4, parseInt(data.severityScore, 10) || 3)) });
  }

  getPriorityLevel() {
    return 3;
  }

  static matchesVitals(v = {}) {
    const hr = v.heartRate !== null && v.heartRate !== undefined && v.heartRate !== '' ? parseInt(v.heartRate, 10) : null;
    const temp = v.temperature !== null && temp !== undefined && v.temperature !== '' ? parseFloat(v.temperature) : null;
    return (hr !== null && hr > 95) || (temp !== null && temp > 37.5);
  }
}

class NonUrgentAssessment extends TriageAssessment {
  constructor(data) {
    super({ ...data, triageCategory: 'Non-Urgent', severityScore: Math.max(1, Math.min(2, parseInt(data.severityScore, 10) || 1)) });
  }

  getPriorityLevel() {
    return 4;
  }

  static matchesVitals() {
    return true; // Default fallback for stable vitals
  }
}

/**
 * ----------------------------------------------------------------------------
 * 3. GOF CREATOR: TriageFactory
 * Declares the Factory Methods for creating Triage Assessments.
 * ----------------------------------------------------------------------------
 */
class TriageFactory {
  // Ordered product registry: highest acuity to lowest
  static assessmentProducts = [
    EmergencyAssessment,
    UrgentAssessment,
    StandardAssessment,
    NonUrgentAssessment
  ];

  /**
   * --------------------------------------------------------------------------
   * FEATURE 1.1: Automated Vitals Triage
   * Polymorphically queries the product hierarchy based on patient vital signs
   * and directly instantiates the matching concrete assessment product.
   * --------------------------------------------------------------------------
   */
  static createFromVitals(inputData) {
    const MatchedProductClass = this.assessmentProducts.find(Product => Product.matchesVitals(inputData)) || NonUrgentAssessment;
    const assessmentId = inputData.id || `TRG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return new MatchedProductClass({
      ...inputData,
      id: assessmentId
    });
  }

  /**
   * Creates a new TriageAssessment instance based on staff-selected category.
   * Enforces category validation and clinical invariants.
   */
  static createAssessment({
    id = null,
    visitId,
    chiefComplaint,
    symptoms = [],
    temperature = null,
    heartRate = null,
    bloodPressure = null,
    respiratoryRate = null,
    oxygenSaturation = null,
    triageCategory,
    severityScore = 1,
    clinicalNotes = '',
    assessedByStaffId = 'STAFF-TRIAGE',
    assessmentTimestamp = null
  }) {
    // 1. Validation check
    const validation = TriageAssessment.validate({
      visitId,
      chiefComplaint,
      triageCategory,
      temperature,
      heartRate,
      bloodPressure,
      respiratoryRate,
      oxygenSaturation
    });

    if (!validation.isValid) {
      throw new Error(`Triage Assessment Validation Failed: ${validation.errors.join(' ')}`);
    }

    const assessmentId = id || `TRG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const parsedSeverity = parseInt(severityScore, 10) || 1;

    // 2. Factory creation based on clinical category
    const categoryKey = String(triageCategory).trim().toLowerCase();
    let assessment;

    switch (categoryKey) {
      case 'emergency':
      case 'priority 1':
      case 'resuscitation':
        assessment = new EmergencyAssessment({
          id: assessmentId,
          visitId,
          chiefComplaint,
          symptoms,
          temperature,
          heartRate,
          bloodPressure,
          respiratoryRate,
          oxygenSaturation,
          severityScore: Math.max(7, parsedSeverity),
          clinicalNotes,
          assessedByStaffId,
          assessmentTimestamp
        });
        break;

      case 'urgent':
      case 'priority 2':
        assessment = new UrgentAssessment({
          id: assessmentId,
          visitId,
          chiefComplaint,
          symptoms,
          temperature,
          heartRate,
          bloodPressure,
          respiratoryRate,
          oxygenSaturation,
          severityScore: Math.max(5, Math.min(6, parsedSeverity || 5)),
          clinicalNotes,
          assessedByStaffId,
          assessmentTimestamp
        });
        break;

      case 'standard':
      case 'routine':
      case 'priority 3':
      case 'opd':
        assessment = new StandardAssessment({
          id: assessmentId,
          visitId,
          chiefComplaint,
          symptoms,
          temperature,
          heartRate,
          bloodPressure,
          respiratoryRate,
          oxygenSaturation,
          severityScore: Math.max(3, Math.min(4, parsedSeverity || 3)),
          clinicalNotes,
          assessedByStaffId,
          assessmentTimestamp
        });
        break;

      case 'non-urgent':
      case 'nonurgent':
      case 'follow-up':
      case 'followup':
      case 'priority 4':
        assessment = new NonUrgentAssessment({
          id: assessmentId,
          visitId,
          chiefComplaint,
          symptoms,
          temperature,
          heartRate,
          bloodPressure,
          respiratoryRate,
          oxygenSaturation,
          severityScore: Math.max(1, Math.min(2, parsedSeverity || 1)),
          clinicalNotes,
          assessedByStaffId,
          assessmentTimestamp
        });
        break;

      default:
        throw new Error(`Unsupported triage category: '${triageCategory}'. Must be Emergency, Urgent, Standard, or Non-Urgent.`);
    }

    return assessment;
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 1.7: Storage Reconstitution
   * Safely rehydrates serialized JSON records from storage back into active domain classes.
   * --------------------------------------------------------------------------
   */
  static reconstitute(data) {
    if (!data) return null;
    return this.createAssessment(data);
  }
}

/**
 * ============================================================================
 * FEATURE 1.6: Typed Patient Product Classification
 * GoF Factory Method creating classified patient products with clinical business invariants.
 * ============================================================================
 */
class PatientProduct {
  constructor(id, name, age, triageType, severityScore, symptoms = []) {
    this.id = id;
    this.name = name;
    this.age = age;
    this.triageType = triageType;
    this.severityScore = parseInt(severityScore, 10) || 1;
    this.symptoms = Array.isArray(symptoms) ? symptoms : [symptoms].filter(Boolean);
    this.stateName = 'Waiting';
    this.assignedDoctor = null;
    this.bedNumber = null;
    this.billingSummary = null;
    this.logs = [`[Triage] Registered as ${triageType} with severity ${this.severityScore}.`];
    this.createdAt = new Date().toISOString();
  }

  getPatientType() {
    return this.triageType;
  }

  getPriorityCategory() {
    return 99;
  }

  serialize() {
    return { ...this };
  }
}

class EmergencyPatient extends PatientProduct {
  getPriorityCategory() {
    return 1;
  }
}

class OPDPatient extends PatientProduct {
  getPriorityCategory() {
    return 2;
  }
}

class FollowUpPatient extends PatientProduct {
  getPriorityCategory() {
    return 3;
  }
}

class PatientFactory {
  static createPatient(id, name, age, type, severityScore = 1, symptoms = []) {
    let patient;
    switch (type) {
      case 'Emergency':
        patient = new EmergencyPatient(id, name, age, type, severityScore, symptoms);
        break;
      case 'OPD':
        patient = new OPDPatient(id, name, age, type, severityScore, symptoms);
        break;
      case 'Follow-up':
      case 'FollowUp':
        patient = new FollowUpPatient(id, name, age, type, severityScore, symptoms);
        break;
      default:
        throw new Error(`Unknown Triage Type: ${type}`);
    }

    // PDF Invariant: Enforce severity flooring for emergency cases
    if (type === 'Emergency' && patient.severityScore < 5) {
      patient.severityScore = 7;
    }

    return patient;
  }

  static reconstitute(data) {
    if (!data) return null;
    let patient;
    switch (data.triageType) {
      case 'Emergency':
        patient = new EmergencyPatient(data.id, data.name, data.age, data.triageType, data.severityScore, data.symptoms);
        break;
      case 'OPD':
        patient = new OPDPatient(data.id, data.name, data.age, data.triageType, data.severityScore, data.symptoms);
        break;
      case 'Follow-up':
      case 'FollowUp':
        patient = new FollowUpPatient(data.id, data.name, data.age, data.triageType, data.severityScore, data.symptoms);
        break;
      default:
        patient = new PatientProduct(data.id, data.name, data.age, data.triageType, data.severityScore, data.symptoms);
    }

    patient.stateName = data.stateName || 'Waiting';
    patient.assignedDoctor = data.assignedDoctor || null;
    patient.bedNumber = data.bedNumber || null;
    patient.billingSummary = data.billingSummary ? JSON.parse(JSON.stringify(data.billingSummary)) : null;
    patient.logs = data.logs || [];
    patient.createdAt = data.createdAt || new Date().toISOString();
    return patient;
  }
}

module.exports = {
  // GoF Factory Method Participants
  TriageFactory,
  TriageAssessment,
  EmergencyAssessment,
  UrgentAssessment,
  StandardAssessment,
  NonUrgentAssessment,

  // PDF Specification Compatibility
  PatientFactory,
  PatientProduct,
  EmergencyPatient,
  OPDPatient,
  FollowUpPatient
};
