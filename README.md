# Hospital Queue and Triage Management System

A full-stack Node.js hospital operational system implementing **Factory Pattern**, **Facade Pattern**, and **State Pattern** with an Express REST API, JSON-backed atomic persistence layer, and a clinical staff web dashboard.

---

## 1. Architectural Overview & Project Structure

```text
Hospital-Queue-Management/
├── js/
│   └── test.js             # Automated 13-stage test suite covering all models & patterns
├── public/
│   ├── css/
│   │   └── style.css       # Clinical UI styling (muted navy, off-white, subtle borders)
│   ├── js/
│   │   └── app.js          # Frontend event controller & REST API client
│   └── index.html          # Clinical staff dashboard (7 modular operational views)
├── server/
│   ├── patterns/
│   │   ├── facade.js       # HospitalQueueFacade + Subsystem Entities (Patient, Doctor, Bed, QueueEntry, BedManager, DoctorScheduler)
│   │   ├── factory.js      # TriageFactory + TriageAssessment & polymorphic product hierarchy (Emergency, Urgent, Standard, NonUrgent)
│   │   └── state.js        # PatientVisit Context + State Pattern governing all 8 visit lifecycle transitions
│   ├── db.js               # DatabaseEngine singleton with atomic file write queue
│   ├── routes.js           # REST API routes delegating directly to HospitalQueueFacade
│   └── server.js           # Express application entrypoint
├── .env.example            # Environment configuration template
├── .gitignore              # Git ignore rules
├── database.json           # Persistent JSON database with doctors and beds seed data
├── inspect_db.js           # Database inspection CLI utility
├── package.json            # NPM project manifest
├── README.md               # Technical documentation & usage instructions
└── repair_db.js            # Database reconciliation & reference repair CLI utility
```

---

## 2. The Core Domain Entities (Encapsulated in Patterns)

| Entity | Location | Key Fields | Primary Responsibilities |
| :--- | :--- | :--- | :--- |
| **`Patient`** | `server/patterns/facade.js` | `id`, `name`, `age`, `dob`, `gender`, `contactNumber`, `medicalAlerts`, `createdAt` | Person entity. Validates required demographic data. Prevents record duplication across repeat visits. |
| **`Doctor`** | `server/patterns/facade.js` | `id`, `name`, `specialty`, `availabilityStatus`, `currentVisitId` | Physician entity. Enforces duty availability (`Available`, `In Consultation`, `On Break`, `Off Duty`). |
| **`Bed`** | `server/patterns/facade.js` | `id`, `ward`, `availabilityStatus`, `allocatedVisitId`, `dailyRate` | Inpatient bed resource across wards (ICU, Emergency, General, Private). Prevents double-allocation. |
| **`TriageAssessment`** | `server/patterns/factory.js` | `id`, `visitId`, `chiefComplaint`, `symptoms`, `vitals`, `triageCategory`, `severityScore` | Clinical observation product. Validates vitals and detects clinical alerts. Created via Factory Pattern. |
| **`PatientVisit`** | `server/patterns/state.js` | `id`, `patientId`, `currentState`, `triageAssessmentId`, `queueEntryId`, `assignedDoctorId`, `allocatedBedId` | Central lifecycle context for the State Pattern. Tracks transitions through disposition. |
| **`QueueEntry`** | `server/patterns/facade.js` | `id`, `patientVisitId`, `patientId`, `triagePriority`, `queueEntryTimestamp`, `queueStatus` | Priority queue placement. Orders by clinical urgency (Priority 1 > 2 > 3 > 4) with FIFO tie-breaker. |

---

## 3. The Three Design Patterns

### Pattern 1: Factory Pattern (`server/patterns/factory.js`)
* **Creator Class**: `TriageFactory`
* **Concrete Products**: `EmergencyAssessment` (Priority 1), `UrgentAssessment` (Priority 2), `StandardAssessment` (Priority 3), `NonUrgentAssessment` (Priority 4).
* **Implementation Details**:
  - Encapsulates object creation away from route handlers.
  - Enforces clinical invariants: if staff classifies a patient as `Emergency`, the factory enforces a minimum severity score floor of `7` and assigns Priority 1.
  - Rejects unknown or malformed categories at domain boundary.
  - Provides `reconstitute()` for deserializing stored JSON records back into class instances.

### Pattern 2: State Pattern (`server/patterns/state.js`)
* **Context**: `PatientVisit`
* **Abstract State**: `VisitState` (defines `getStateName()`, `next(visit, action, payload)`, `isTerminal()`).
* **Concrete States**:
  1. `RegisteredState`: Initial registration upon arrival.
  2. `AwaitingTriageState`: Patient ready for nursing vitals intake.
  3. `WaitingState`: Triage complete; waiting in clinical priority queue.
  4. `CalledState`: Called to consultation room by an assigned doctor.
  5. `InConsultationState`: Actively under examination by physician.
  6. `CompletedState` *(Terminal)*: Outpatient care resolved.
  7. `AdmittedState` *(Terminal)*: Admitted to inpatient bed.
  8. `ReferredState` *(Terminal)*: Transferred to external medical specialist facility.
* **Transition Guards & Lifecycle**:
  - Rejects illegal state jumps (e.g. directly jumping from `Waiting` to `Completed` without consultation).
  - Terminal states strictly prevent further state mutations.
  - Missed call policy enables transition from `Called` back to `Waiting`.
  - Audits every transition in `visit.stateHistory` and `visit.logs`.
  - Cached singletons managed by `StateFactory` (Flyweight optimization).

### Pattern 3: Facade Pattern (`server/patterns/facade.js`)
* **Facade Class**: `HospitalQueueFacade`
* **Coordinated Subsystems**:
  - `BedManager`: Handles ward bed availability and reservations.
  - `DoctorScheduler`: Manages physician assignments and duty status.
  - `DatabaseEngine`: Thread-safe persistence and querying.
  - `TriageFactory`: Instantiation of triage assessments.
  - `StateFactory`: Execution of valid state transitions.
* **Unified Methods**:
  - `registerPatient(patientData)`
  - `createVisit(patientId, visitDetails)`
  - `completeTriage(visitId, triageData, staffId)`
  - `getPriorityQueue(filters)`
  - `callNextPatient(doctorId, options)`
  - `startConsultation(visitId, doctorId)`
  - `completeVisit(visitId, consultationNotes)`
  - `admitPatient(visitId, bedIdOrWard, admissionDetails)`
  - `referPatient(visitId, referralDetails)`
  - `requeuePatient(visitId, reason)`
  - `getDashboardStats()`
* **Transactional Integrity**: Multi-step operations (e.g. bed allocation followed by visit state update) include compensating rollbacks: if state transition throws an error, the allocated bed is immediately released.

---

## 4. REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/dashboard/stats` | `GET` | Real-time counts of active visits, triage queue, waiting queue, in consultation, available doctors, available beds. |
| `/api/patients/register` | `POST` | Registers a new patient. Validates name, contact, age/dob. |
| `/api/patients` | `GET` | Searches patients by name, contact, or ID (`?q=query`). |
| `/api/visits/create` | `POST` | Creates a new visit in `RegisteredState` and advances to `AwaitingTriageState`. |
| `/api/visits/:id` | `GET` | Fetches complete visit dossier (patient, assessment, queue, doctor, bed, audit history). |
| `/api/triage/assess` | `POST` | Submits triage data via `TriageFactory`, transitions visit to `WaitingState`, creates `QueueEntry`. |
| `/api/queue` | `GET` | Returns active queue ordered by clinical priority (P1 > P2 > P3 > P4) and wait time. |
| `/api/queue/call-next` | `POST` | Calls highest-priority waiting patient for designated doctor; transitions visit to `CalledState`. |
| `/api/queue/requeue` | `POST` | Missed call handler: transitions visit from `CalledState` back to `WaitingState`. |
| `/api/consultations/start` | `POST` | Begins doctor consultation; transitions visit to `InConsultationState`. |
| `/api/consultations/complete`| `POST` | Concludes outpatient visit; transitions to `CompletedState`; frees doctor. |
| `/api/consultations/admit` | `POST` | Reserves bed via `BedManager`; transitions to `AdmittedState`; frees doctor. |
| `/api/consultations/refer` | `POST` | Records specialist transfer; transitions to `ReferredState`; frees doctor. |
| `/api/doctors` | `GET` | Returns physician roster and availability. |
| `/api/doctors/status` | `POST` | Updates physician duty status (`Available`, `On Break`, `Off Duty`). |
| `/api/beds` | `GET` | Returns bed inventory across ICU, Emergency, General Ward, and Private Room. |
| `/api/beds/release/:bedId` | `POST` | Sanitizes and releases occupied bed back to `Available`. |
| `/api/history` | `GET` | Searchable archive of resolved visits with audit trails. |

---

## 5. Setup & Running Instructions

### Prerequisites
- Node.js (v18.0.0 or later)
- npm (v9.0.0 or later)

### Installation
```bash
# Install dependencies
npm install
```

### Running the Application Server
```bash
# Start Express server on http://localhost:3000
npm start
```
Open your browser to:
[http://localhost:3000](http://localhost:3000)

### Running the Automated Test Suite
```bash
# Executes all 13 required verification stages
npm test
```

### Database Inspection & Maintenance
```bash
# View database statistics, doctor statuses, and bed allocations
npm run inspect

# Run data integrity checks and repair orphaned references
npm run repair
```

---

## 6. Verification Test Suite Coverage (`js/test.js`)

The test suite validates 13 distinct workflow and pattern criteria:
1. Patient registration & demographic validation.
2. Hospital visit creation for registered patients.
3. Triage assessment creation through `TriageFactory` (emergency severity flooring, priority categorization).
4. Priority queue entry generation via `HospitalQueueFacade`.
5. Clinical priority queue ordering (Priority 1 immediate precedence; FIFO wait-time tie-breaker).
6. State Pattern lifecycle invariants and invalid transition rejection.
7. Next eligible patient calling mechanism with doctor availability guard.
8. Consultation initiation with physician status tracking.
9. Outpatient completion, inpatient bed admission, and specialist referral workflows.
10. Bed allocation, double-allocation prevention, and bed sanitization release.
11. Prevention of duplicate active queue entries for the same patient visit.
12. Physiological vital sign range validation and domain exceptions.
13. Complete end-to-end patient journey from registration through consultation outcome and audit trail verification.
#   d e s i g n _ p a t t e r n s  
 