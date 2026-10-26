const fs = require('fs');
const path = require('path');

class DatabaseEngine {
  constructor(filePath = null) {
    this.filePath = filePath || process.env.DB_FILE_PATH || path.join(__dirname, '..', 'database.json');
    this.isWriting = false;
    this.writeQueue = [];
    this.data = this._loadInitial();
  }

  static getInstance(filePath = null) {
    if (!DatabaseEngine.instance) {
      DatabaseEngine.instance = new DatabaseEngine(filePath);
    }
    return DatabaseEngine.instance;
  }

  _loadInitial() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        parsed.bills = parsed.bills || [];
        return parsed;
      }
    } catch (err) {
      console.error(`[DatabaseEngine] Error reading database file: ${err.message}. Initializing defaults.`);
    }

    const defaultData = {
      patients: [],
      patientVisits: [],
      triageAssessments: [],
      queueEntries: [],
      doctors: [],
      beds: [],
      bills: []
    };
    this._persistSync(defaultData);
    return defaultData;
  }

  _persistSync(data) {
    const tempPath = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(tempPath, serialized, 'utf-8');
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch (_) {
        fs.copyFileSync(tempPath, this.filePath);
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    } catch (_) {
      fs.writeFileSync(this.filePath, serialized, 'utf-8');
    }
  }

  async persist() {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;
    this.isWriting = true;
    const current = this.writeQueue.shift();

    try {
      const serialized = JSON.stringify(this.data, null, 2);
      try {
        const tempPath = `${this.filePath}.${Date.now()}.tmp`;
        await fs.promises.writeFile(tempPath, serialized, 'utf-8');
        try {
          await fs.promises.rename(tempPath, this.filePath);
        } catch (renameErr) {
          await fs.promises.copyFile(tempPath, this.filePath);
          await fs.promises.unlink(tempPath).catch(() => {});
        }
      } catch (writeErr) {
        await fs.promises.writeFile(this.filePath, serialized, 'utf-8');
      }
      current.resolve(true);
    } catch (err) {
      console.error('[DatabaseEngine] Persistence error:', err);
      current.reject(err);
    } finally {
      this.isWriting = false;
      if (this.writeQueue.length > 0) {
        this._processQueue();
      }
    }
  }

  // --- Patients ---
  getPatients() {
    return [...(this.data.patients || [])];
  }

  getPatientById(id) {
    return (this.data.patients || []).find(p => p.id === id) || null;
  }

  findPatients(query) {
    if (!query) return this.getPatients();
    const q = query.toLowerCase().trim();
    return (this.data.patients || []).filter(p => 
      (p.id && p.id.toLowerCase().includes(q)) ||
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.contactNumber && p.contactNumber.includes(q)) ||
      (p.contact && p.contact.includes(q))
    );
  }

  async savePatient(patient) {
    const serialized = patient.serialize ? patient.serialize() : { ...patient };
    const index = (this.data.patients || []).findIndex(p => p.id === serialized.id);
    if (index >= 0) {
      this.data.patients[index] = serialized;
    } else {
      this.data.patients.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Patient Visits ---
  getVisits() {
    return [...(this.data.patientVisits || [])];
  }

  getVisitById(id) {
    return (this.data.patientVisits || []).find(v => v.id === id) || null;
  }

  getVisitsByPatientId(patientId) {
    return (this.data.patientVisits || []).filter(v => v.patientId === patientId);
  }

  getActiveVisits() {
    const activeStates = ['Registered', 'Awaiting Triage', 'Waiting', 'Called', 'In Consultation'];
    return (this.data.patientVisits || []).filter(v => activeStates.includes(v.currentState));
  }

  async saveVisit(visit) {
    const serialized = visit.serialize ? visit.serialize() : { ...visit };
    const index = (this.data.patientVisits || []).findIndex(v => v.id === serialized.id);
    if (index >= 0) {
      this.data.patientVisits[index] = serialized;
    } else {
      this.data.patientVisits.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Triage Assessments ---
  getAssessments() {
    return [...(this.data.triageAssessments || [])];
  }

  getAssessmentById(id) {
    return (this.data.triageAssessments || []).find(a => a.id === id) || null;
  }

  getAssessmentByVisitId(visitId) {
    return (this.data.triageAssessments || []).find(a => a.visitId === visitId) || null;
  }

  async saveAssessment(assessment) {
    const serialized = assessment.serialize ? assessment.serialize() : { ...assessment };
    const index = (this.data.triageAssessments || []).findIndex(a => a.id === serialized.id);
    if (index >= 0) {
      this.data.triageAssessments[index] = serialized;
    } else {
      this.data.triageAssessments.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Queue Entries ---
  getQueueEntries() {
    return [...(this.data.queueEntries || [])];
  }

  getQueueEntryById(id) {
    return (this.data.queueEntries || []).find(q => q.id === id) || null;
  }

  getActiveQueueEntries() {
    const activeStatuses = ['Waiting', 'Called'];
    return (this.data.queueEntries || []).filter(q => activeStatuses.includes(q.queueStatus));
  }

  getQueueEntryByVisitId(visitId) {
    return (this.data.queueEntries || []).find(q => q.patientVisitId === visitId && ['Waiting', 'Called', 'In Consultation'].includes(q.queueStatus)) || null;
  }

  async saveQueueEntry(entry) {
    const serialized = entry.serialize ? entry.serialize() : { ...entry };
    const index = (this.data.queueEntries || []).findIndex(q => q.id === serialized.id);
    if (index >= 0) {
      this.data.queueEntries[index] = serialized;
    } else {
      this.data.queueEntries.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Doctors ---
  getDoctors() {
    return [...(this.data.doctors || [])];
  }

  getDoctorById(id) {
    return (this.data.doctors || []).find(d => d.id === id) || null;
  }

  getAvailableDoctors() {
    return (this.data.doctors || []).filter(d => d.availabilityStatus === 'Available');
  }

  async saveDoctor(doctor) {
    const serialized = doctor.serialize ? doctor.serialize() : { ...doctor };
    const index = (this.data.doctors || []).findIndex(d => d.id === serialized.id);
    if (index >= 0) {
      this.data.doctors[index] = serialized;
    } else {
      this.data.doctors.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Beds ---
  getBeds() {
    return [...(this.data.beds || [])];
  }

  getBedById(id) {
    return (this.data.beds || []).find(b => b.id === id) || null;
  }

  getAvailableBeds(ward = null) {
    return (this.data.beds || []).filter(b => {
      const isAvail = b.availabilityStatus === 'Available';
      return ward ? (isAvail && b.ward.toLowerCase() === ward.toLowerCase()) : isAvail;
    });
  }

  async saveBed(bed) {
    const serialized = bed.serialize ? bed.serialize() : { ...bed };
    const index = (this.data.beds || []).findIndex(b => b.id === serialized.id);
    if (index >= 0) {
      this.data.beds[index] = serialized;
    } else {
      this.data.beds.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Billing ---
  getBills() {
    return this.data.bills || [];
  }

  getBillById(id) {
    return (this.data.bills || []).find(b => b.id === id) || null;
  }

  getBillByVisitId(visitId) {
    return (this.data.bills || []).find(b => b.visitId === visitId) || null;
  }

  async saveBill(bill) {
    if (!this.data.bills) this.data.bills = [];
    const serialized = bill.serialize ? bill.serialize() : { ...bill };
    const index = this.data.bills.findIndex(b => b.id === serialized.id);
    if (index >= 0) {
      this.data.bills[index] = serialized;
    } else {
      this.data.bills.push(serialized);
    }
    await this.persist();
    return serialized;
  }

  // --- Utilities ---
  async reload() {
    this.data = this._loadInitial();
    return this.data;
  }

  async resetData(defaults = null) {
    if (defaults) {
      this.data = JSON.parse(JSON.stringify(defaults));
      this.data.bills = this.data.bills || [];
    } else {
      this.data = {
        patients: [],
        patientVisits: [],
        triageAssessments: [],
        queueEntries: [],
        doctors: this.getDoctors().map(d => ({ ...d, availabilityStatus: 'Available', currentVisitId: null })),
        beds: this.getBeds().map(b => ({ ...b, availabilityStatus: 'Available', allocatedVisitId: null })),
        bills: []
      };
    }
    await this.persist();
    return this.data;
  }
}

module.exports = DatabaseEngine;
