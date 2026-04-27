const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
} = require("./lib/utils");
const { DEFAULT_SEED_PASSWORD, hashPassword } = require("./lib/security");
const {
  adminAccount,
  doctorAccounts,
  legacyDoctorNames,
  supportAccounts,
} = require("./config/seedData");

const explicitDbPath = process.env.DB_PATH;
const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const isVercelRuntime = Boolean(process.env.VERCEL);
const defaultDbPath = path.join(
  volumeMountPath || (isVercelRuntime ? path.join("/tmp") : path.join(__dirname, "..", "data")),
  "clinic.db",
);
const dbPath = explicitDbPath || defaultDbPath;
const labReportAttachmentsDir = path.join(path.dirname(dbPath), "lab-report-attachments");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(labReportAttachmentsDir, { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const seededPatients = [
  {
    first_name: "John",
    last_name: "Carter",
    patient_id_number: "NIC-920101-001",
    date_of_birth: "1992-01-01",
    gender: "M",
    patient_contact_number: "+1 555-0123",
    address: "Villa 18, Coastal Drive",
    location: "Anahita Residence",
    past_medical_history: "Type 2 diabetes managed with oral medication.",
    past_surgical_history: "Appendectomy in 2017.",
    drug_history: "Metformin 500 mg twice daily with home glucose monitoring.",
    drug_allergy_history: "Penicillin",
    particularity: "Requires late afternoon appointments whenever possible.",
    consultation_notes:
      "Initial intake completed with blood sugar review and adherence counseling.",
    status: "active",
    ongoing_treatment: "Weekly glucose monitoring and medication review.",
    next_of_kin_name: "Laura Carter",
    next_of_kin_relationship: "Spouse",
    next_of_kin_contact_number: "+1 555-0166",
    next_of_kin_email: "laura.carter@example.com",
    next_of_kin_address: "18 Pine Avenue, Springfield",
    assigned_doctor_name: doctorAccounts[0].full_name,
  },
  {
    first_name: "Maya",
    last_name: "Singh",
    patient_id_number: "PPT-MU1999-204",
    date_of_birth: "1999-01-01",
    gender: "F",
    patient_contact_number: "+1 555-0199",
    address: "42 Ocean View Lane",
    location: "Azuri Residence",
    past_medical_history: "Migraine history with intermittent seasonal allergies.",
    past_surgical_history: "No prior surgeries.",
    drug_history: "Uses ibuprofen intermittently during migraine flares.",
    drug_allergy_history: "No known drug allergies.",
    particularity: "Prefers communication through family support when symptomatic.",
    consultation_notes:
      "Initial registration noted recurrent headache episodes and seasonal triggers.",
    status: "discharged",
    ongoing_treatment: "",
    next_of_kin_name: "Anika Singh",
    next_of_kin_relationship: "Sister",
    next_of_kin_contact_number: "+1 555-0184",
    next_of_kin_email: "anika.singh@example.com",
    next_of_kin_address: "42 Cedar Lane, Springfield",
    assigned_doctor_name: doctorAccounts[1].full_name,
  },
];

function getUsersTableSql() {
  return db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get()?.sql;
}

function tableExists(name) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function createUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'operator', 'lab_tech', 'accountant')),
      password_hash TEXT NOT NULL,
      doctor_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      operation_status TEXT NOT NULL DEFAULT 'active'
        CHECK (operation_status IN ('available', 'active', 'offline')),
      operation_status_updated_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
    );
  `);
}

function createAuthSessionsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function createLabReportsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      consultation_id INTEGER,
      report_title TEXT NOT NULL,
      report_date TEXT NOT NULL,
      report_details TEXT NOT NULL,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function createLabReportAttachmentsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_report_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      consultation_id INTEGER,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      relative_path TEXT NOT NULL,
      uploaded_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES lab_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function createPatientRevisionsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      previous_snapshot TEXT NOT NULL,
      updated_snapshot TEXT NOT NULL,
      changed_fields TEXT NOT NULL DEFAULT '[]',
      changed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function createPatientOperatorAccessTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_operator_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      operator_user_id INTEGER NOT NULL,
      granted_by_user_id INTEGER,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function createHcmNewsPostsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hcm_news_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function createHcmNewsReadsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_hcm_news_reads (
      user_id INTEGER PRIMARY KEY,
      last_seen_post_id INTEGER,
      last_seen_post_updated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function createPatientLocationsTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE (category, name)
    );

    CREATE TABLE IF NOT EXISTS patient_locations (
      patient_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (patient_id, location_id),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
    );
  `);
}

function createInventoryFoldersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES inventory_folders(id) ON DELETE CASCADE
    );
  `);
}

function createInventoryMovementsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL
        CHECK (movement_type IN ('in', 'out', 'adjustment')),
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      previous_quantity INTEGER NOT NULL DEFAULT 0,
      next_quantity INTEGER NOT NULL DEFAULT 0,
      doctor_id INTEGER,
      recorded_by_user_id INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function migrateUsersSchemaIfNeeded() {
  const usersTableSql = getUsersTableSql();

  if (!usersTableSql || usersTableSql.includes("'admin'")) {
    return;
  }

  db.pragma("foreign_keys = OFF");

  const migrate = db.transaction(() => {
    if (tableExists("auth_sessions")) {
      db.exec("ALTER TABLE auth_sessions RENAME TO auth_sessions_legacy");
    }

    if (tableExists("lab_reports")) {
      db.exec("ALTER TABLE lab_reports RENAME TO lab_reports_legacy");
    }

    db.exec("ALTER TABLE users RENAME TO users_legacy");

    createUsersTable();
    db.exec(`
      INSERT INTO users (
        id,
        username,
        full_name,
        role,
        password_hash,
        doctor_id,
        is_active,
        operation_status,
        operation_status_updated_at,
        created_at
      )
      SELECT
        id,
        username,
        full_name,
        role,
        password_hash,
        doctor_id,
        is_active,
        'active',
        created_at,
        created_at
      FROM users_legacy
    `);

    createAuthSessionsTable();
    createLabReportsTable();

    if (tableExists("lab_reports_legacy")) {
      db.exec(`
        INSERT INTO lab_reports (
          id,
          patient_id,
          consultation_id,
          report_title,
          report_date,
          report_details,
          created_by_user_id,
          created_at,
          updated_at
        )
        SELECT
          id,
          patient_id,
          consultation_id,
          report_title,
          report_date,
          report_details,
          created_by_user_id,
          created_at,
          updated_at
        FROM lab_reports_legacy
      `);
    }

    db.exec("DROP TABLE IF EXISTS auth_sessions_legacy");
    db.exec("DROP TABLE IF EXISTS lab_reports_legacy");
    db.exec("DROP TABLE users_legacy");
  });

  migrate();
  db.pragma("foreign_keys = ON");
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      patient_identifier TEXT NOT NULL DEFAULT '',
      patient_id_number TEXT NOT NULL DEFAULT '',
      age INTEGER NOT NULL CHECK (age >= 0),
      date_of_birth TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'M' CHECK (gender IN ('M', 'F')),
      assigned_doctor_id INTEGER,
      contact_number TEXT NOT NULL,
      patient_contact_number TEXT NOT NULL DEFAULT '',
      contact_relationship TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      past_medical_history TEXT NOT NULL DEFAULT '',
      past_surgical_history TEXT NOT NULL DEFAULT '',
      drug_history TEXT NOT NULL DEFAULT '',
      drug_allergy_history TEXT NOT NULL DEFAULT '',
      particularity TEXT NOT NULL DEFAULT '',
      consultation_notes TEXT NOT NULL DEFAULT '',
      next_of_kin_name TEXT NOT NULL DEFAULT '',
      next_of_kin_relationship TEXT NOT NULL DEFAULT '',
      next_of_kin_contact_number TEXT NOT NULL DEFAULT '',
      next_of_kin_email TEXT NOT NULL DEFAULT '',
      next_of_kin_address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discharged')),
      ongoing_treatment TEXT NOT NULL DEFAULT '',
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      specialization TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      consultation_date TEXT NOT NULL,
      doctor_notes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS billing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      items TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
      payment_method TEXT
        CHECK (payment_method IN ('cash', 'juice', 'card', 'ib') OR payment_method IS NULL),
      payment_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS inventory_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES inventory_folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      folder_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 0,
      minimum_quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES inventory_folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL
        CHECK (movement_type IN ('in', 'out', 'adjustment')),
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      previous_quantity INTEGER NOT NULL DEFAULT 0,
      next_quantity INTEGER NOT NULL DEFAULT 0,
      doctor_id INTEGER,
      recorded_by_user_id INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS seed_control (
      id INTEGER PRIMARY KEY,
      seeded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migrateUsersSchemaIfNeeded();
  createUsersTable();
  createAuthSessionsTable();
  createLabReportsTable();
  createLabReportAttachmentsTable();
  createPatientRevisionsTable();
  createPatientOperatorAccessTable();
  createHcmNewsPostsTable();
  createHcmNewsReadsTable();
  createPatientLocationsTables();
  createInventoryFoldersTable();
  createInventoryMovementsTable();

  ensurePatientColumns();
  ensureDoctorColumns();
  ensureUserColumns();
  ensureHcmNewsColumns();
  ensureBillingColumns();
  ensureInventoryColumns();
  backfillPatientRecords();
  backfillPatientLocations();
  ensureInventorySeedData();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(consultation_date);
    CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status);
    CREATE INDEX IF NOT EXISTS idx_billing_consultation ON billing(consultation_id);
    CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);
    CREATE INDEX IF NOT EXISTS idx_lab_reports_date ON lab_reports(report_date);
    CREATE INDEX IF NOT EXISTS idx_lab_report_attachments_report
      ON lab_report_attachments(report_id);
    CREATE INDEX IF NOT EXISTS idx_lab_report_attachments_patient
      ON lab_report_attachments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_lab_report_attachments_consultation
      ON lab_report_attachments(consultation_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_patients_assigned_doctor ON patients(assigned_doctor_id);
    CREATE INDEX IF NOT EXISTS idx_patients_deleted_at ON patients(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(is_active);
    CREATE INDEX IF NOT EXISTS idx_doctors_deleted_at ON doctors(deleted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_identifier_unique
      ON patients(patient_identifier)
      WHERE patient_identifier IS NOT NULL AND patient_identifier != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_patient_id_number_unique
      ON patients(patient_id_number)
      WHERE patient_id_number IS NOT NULL AND patient_id_number != '';
    CREATE INDEX IF NOT EXISTS idx_patient_revisions_patient ON patient_revisions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_patient_operator_access_patient
      ON patient_operator_access(patient_id);
    CREATE INDEX IF NOT EXISTS idx_patient_operator_access_operator
      ON patient_operator_access(operator_user_id);
    CREATE INDEX IF NOT EXISTS idx_patient_operator_access_expires
      ON patient_operator_access(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_operation_status ON users(operation_status);
    CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_hcm_news_posts_created_at ON hcm_news_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_hcm_news_posts_updated_at ON hcm_news_posts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_hcm_news_posts_status ON hcm_news_posts(status);
    CREATE INDEX IF NOT EXISTS idx_locations_category ON locations(category);
    CREATE INDEX IF NOT EXISTS idx_patient_locations_patient ON patient_locations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_patient_locations_location ON patient_locations(location_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_folder ON inventory(folder_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_item_name ON inventory(item_name);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_doctor ON inventory_movements(doctor_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at);
  `);

  migrateLegacySeedDataIfNeeded();
  seedDatabase();
}

function ensureHcmNewsColumns() {
  const columns = db
    .prepare("PRAGMA table_info(hcm_news_posts)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("status")) {
    db.exec(
      "ALTER TABLE hcm_news_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))",
    );
  }
}

function ensurePatientColumns() {
  const columns = db
    .prepare("PRAGMA table_info(patients)")
    .all()
    .map((column) => column.name);

  const requiredColumns = [
    {
      name: "first_name",
      sql: "ALTER TABLE patients ADD COLUMN first_name TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "last_name",
      sql: "ALTER TABLE patients ADD COLUMN last_name TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "patient_identifier",
      sql: "ALTER TABLE patients ADD COLUMN patient_identifier TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "patient_id_number",
      sql: "ALTER TABLE patients ADD COLUMN patient_id_number TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "date_of_birth",
      sql: "ALTER TABLE patients ADD COLUMN date_of_birth TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "assigned_doctor_id",
      sql: "ALTER TABLE patients ADD COLUMN assigned_doctor_id INTEGER",
    },
    {
      name: "gender",
      sql: "ALTER TABLE patients ADD COLUMN gender TEXT NOT NULL DEFAULT 'M' CHECK (gender IN ('M', 'F'))",
    },
    {
      name: "contact_relationship",
      sql: "ALTER TABLE patients ADD COLUMN contact_relationship TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "patient_contact_number",
      sql: "ALTER TABLE patients ADD COLUMN patient_contact_number TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "location",
      sql: "ALTER TABLE patients ADD COLUMN location TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "past_medical_history",
      sql: "ALTER TABLE patients ADD COLUMN past_medical_history TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "past_surgical_history",
      sql: "ALTER TABLE patients ADD COLUMN past_surgical_history TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "drug_allergy_history",
      sql: "ALTER TABLE patients ADD COLUMN drug_allergy_history TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "drug_history",
      sql: "ALTER TABLE patients ADD COLUMN drug_history TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "status",
      sql: "ALTER TABLE patients ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discharged'))",
    },
    {
      name: "ongoing_treatment",
      sql: "ALTER TABLE patients ADD COLUMN ongoing_treatment TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "particularity",
      sql: "ALTER TABLE patients ADD COLUMN particularity TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "consultation_notes",
      sql: "ALTER TABLE patients ADD COLUMN consultation_notes TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "next_of_kin_name",
      sql: "ALTER TABLE patients ADD COLUMN next_of_kin_name TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "next_of_kin_relationship",
      sql: "ALTER TABLE patients ADD COLUMN next_of_kin_relationship TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "next_of_kin_contact_number",
      sql: "ALTER TABLE patients ADD COLUMN next_of_kin_contact_number TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "next_of_kin_email",
      sql: "ALTER TABLE patients ADD COLUMN next_of_kin_email TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "next_of_kin_address",
      sql: "ALTER TABLE patients ADD COLUMN next_of_kin_address TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "deleted_at",
      sql: "ALTER TABLE patients ADD COLUMN deleted_at TEXT",
    },
  ];

  requiredColumns.forEach((column) => {
    if (!columns.includes(column.name)) {
      db.exec(column.sql);
    }
  });
}

function ensureDoctorColumns() {
  const columns = db
    .prepare("PRAGMA table_info(doctors)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("is_active")) {
    db.exec(
      "ALTER TABLE doctors ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))",
    );
  }

  if (!columns.includes("deleted_at")) {
    db.exec("ALTER TABLE doctors ADD COLUMN deleted_at TEXT");
  }
}

function ensureUserColumns() {
  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("operation_status")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN operation_status TEXT NOT NULL DEFAULT 'active' CHECK (operation_status IN ('available', 'active', 'offline'))",
    );
  }

  if (!columns.includes("operation_status_updated_at")) {
    db.exec("ALTER TABLE users ADD COLUMN operation_status_updated_at TEXT");
  }

  if (!columns.includes("deleted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
  }

  db.prepare(`
    UPDATE users
    SET
      operation_status = COALESCE(NULLIF(operation_status, ''), 'active'),
      operation_status_updated_at = COALESCE(operation_status_updated_at, created_at)
  `).run();
}

function ensureBillingColumns() {
  const columns = db
    .prepare("PRAGMA table_info(billing)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("payment_method")) {
    db.exec(`
      ALTER TABLE billing
      ADD COLUMN payment_method TEXT
        CHECK (payment_method IN ('cash', 'juice', 'card', 'ib') OR payment_method IS NULL)
    `);
  }

  const billingTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'billing'")
    .get()?.sql;

  if (/consultation_id\s+INTEGER\s+NOT NULL\s+UNIQUE/i.test(billingTableSql || "")) {
    db.pragma("foreign_keys = OFF");
    try {
      const migrate = db.transaction(() => {
        db.exec("ALTER TABLE billing RENAME TO billing_legacy");
        db.exec(`
          CREATE TABLE billing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            consultation_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            items TEXT NOT NULL,
            total_amount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
            payment_method TEXT
              CHECK (payment_method IN ('cash', 'juice', 'card', 'ib') OR payment_method IS NULL),
            payment_date TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
          );
        `);
        db.exec(`
          INSERT INTO billing (
            id,
            consultation_id,
            patient_id,
            items,
            total_amount,
            status,
            payment_method,
            payment_date,
            created_at
          )
          SELECT
            id,
            consultation_id,
            patient_id,
            items,
            total_amount,
            status,
            payment_method,
            payment_date,
            created_at
          FROM billing_legacy
        `);
        db.exec("DROP TABLE billing_legacy");
      });

      migrate();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

function ensureInventoryColumns() {
  const columns = db
    .prepare("PRAGMA table_info(inventory)")
    .all()
    .map((column) => column.name);

  const requiredColumns = [
    {
      name: "folder_id",
      sql: "ALTER TABLE inventory ADD COLUMN folder_id INTEGER",
    },
    {
      name: "minimum_quantity",
      sql: "ALTER TABLE inventory ADD COLUMN minimum_quantity INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "cost_price",
      sql: "ALTER TABLE inventory ADD COLUMN cost_price REAL NOT NULL DEFAULT 0",
    },
    {
      name: "selling_price",
      sql: "ALTER TABLE inventory ADD COLUMN selling_price REAL NOT NULL DEFAULT 0",
    },
    {
      name: "notes",
      sql: "ALTER TABLE inventory ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "created_at",
      sql: "ALTER TABLE inventory ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
  ];

  requiredColumns.forEach((column) => {
    if (!columns.includes(column.name)) {
      db.exec(column.sql);
    }
  });
}

function ensureInventorySeedData() {
  const folderCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_folders").get().count,
  );

  let mainStockId = db
    .prepare("SELECT id FROM inventory_folders WHERE name = ? AND parent_id IS NULL")
    .get("Main Stock")?.id;
  let drStockId = db
    .prepare("SELECT id FROM inventory_folders WHERE name = ? AND parent_id IS NULL")
    .get("Dr Stock")?.id;

  if (!folderCount) {
    const insertFolder = db.prepare(`
      INSERT INTO inventory_folders (name, parent_id)
      VALUES (?, ?)
    `);

    mainStockId = Number(insertFolder.run("Main Stock", null).lastInsertRowid);
    drStockId = Number(insertFolder.run("Dr Stock", null).lastInsertRowid);
    insertFolder.run("Consumable", mainStockId);
    insertFolder.run("IM Drugs", mainStockId);
  } else {
    if (!mainStockId) {
      mainStockId = Number(
        db
          .prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, NULL)")
          .run("Main Stock").lastInsertRowid,
      );
    }

    if (!drStockId) {
      db.prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, NULL)").run(
        "Dr Stock",
      );
    }

    const mainChildNames = new Set(
      db
        .prepare("SELECT name FROM inventory_folders WHERE parent_id = ?")
        .all(mainStockId)
        .map((row) => row.name),
    );

    if (!mainChildNames.has("Consumable")) {
      db.prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, ?)").run(
        "Consumable",
        mainStockId,
      );
    }

    if (!mainChildNames.has("IM Drugs")) {
      db.prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, ?)").run(
        "IM Drugs",
        mainStockId,
      );
    }
  }

  if (mainStockId) {
    db.prepare(`
      UPDATE inventory
      SET folder_id = COALESCE(folder_id, ?)
      WHERE folder_id IS NULL
    `).run(mainStockId);
  }
}

function splitPatientName(fullName) {
  const normalized = String(fullName || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return { firstName: "", lastName: "" };
  }

  const parts = normalized.split(" ");

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function buildPatientFullName(firstName, lastName) {
  return [String(firstName || "").trim(), String(lastName || "").trim()].filter(Boolean).join(" ");
}

function getNextPatientIdentifier() {
  const latestIdentifier = db
    .prepare(`
      SELECT patient_identifier
      FROM patients
      WHERE patient_identifier GLOB 'OCS-[0-9]*'
      ORDER BY CAST(substr(patient_identifier, 5) AS INTEGER) DESC
      LIMIT 1
    `)
    .get()?.patient_identifier;

  const latestNumber = latestIdentifier
    ? Number.parseInt(String(latestIdentifier).replace(/^OCS-/, ""), 10)
    : Number.NaN;
  const nextNumber = Number.isFinite(latestNumber) ? latestNumber + 1 : 150;

  return `OCS-${nextNumber}`;
}

function deriveDateOfBirthFromAge(age) {
  const numericAge = Number(age);

  if (!Number.isInteger(numericAge) || numericAge < 0) {
    return "";
  }

  const currentYear = new Date().getFullYear();
  return `${currentYear - numericAge}-01-01`;
}

function calculateAgeFromDateOfBirth(dateOfBirth) {
  const normalized = String(dateOfBirth || "").trim();

  if (!normalized) {
    return 0;
  }

  const today = new Date();
  const birthDate = new Date(`${normalized}T00:00:00`);

  if (Number.isNaN(birthDate.getTime())) {
    return 0;
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function backfillPatientRecords() {
  const patients = db.prepare("SELECT * FROM patients ORDER BY id ASC").all();

  if (!patients.length) {
    return;
  }

  const updatePatient = db.prepare(`
    UPDATE patients
    SET
      full_name = ?,
      first_name = ?,
      last_name = ?,
      patient_identifier = ?,
      patient_id_number = ?,
      date_of_birth = ?,
      age = ?,
      patient_contact_number = ?,
      contact_number = ?,
      location = ?,
      next_of_kin_relationship = ?
    WHERE id = ?
  `);

  const usedIdentifiers = new Set(
    patients
      .map((patient) => String(patient.patient_identifier || "").trim())
      .filter(Boolean),
  );

  const backfill = db.transaction(() => {
    patients.forEach((patient) => {
      const existingFirstName = String(patient.first_name || "").trim();
      const existingLastName = String(patient.last_name || "").trim();
      const derivedName =
        existingFirstName || existingLastName
          ? { firstName: existingFirstName, lastName: existingLastName }
          : splitPatientName(patient.full_name);
      const fullName =
        buildPatientFullName(derivedName.firstName, derivedName.lastName) ||
        String(patient.full_name || "").trim();
      const patientContactNumber = String(
        patient.patient_contact_number || patient.contact_number || "",
      ).trim();
      const patientIdNumber = String(patient.patient_id_number || "").trim().toUpperCase();
      const dateOfBirth = String(
        patient.date_of_birth || deriveDateOfBirthFromAge(patient.age),
      ).trim();
      const derivedAge = calculateAgeFromDateOfBirth(dateOfBirth);
      const location = String(patient.location || "").trim();
      const nextOfKinRelationship = String(
        patient.next_of_kin_relationship || patient.contact_relationship || "",
      ).trim();

      let patientIdentifier = String(patient.patient_identifier || "").trim().toUpperCase();

      if (!patientIdentifier) {
        do {
          patientIdentifier = getNextPatientIdentifier();
        } while (usedIdentifiers.has(patientIdentifier));
      }

      usedIdentifiers.add(patientIdentifier);

      updatePatient.run(
        fullName,
        derivedName.firstName,
        derivedName.lastName,
        patientIdentifier,
        patientIdNumber,
        dateOfBirth,
        derivedAge,
        patientContactNumber,
        patientContactNumber,
        location,
        nextOfKinRelationship,
        patient.id,
      );
    });
  });

  backfill();
}

function backfillPatientLocations() {
  const rows = db
    .prepare(`
      SELECT id, location
      FROM patients
      WHERE location IS NOT NULL
        AND trim(location) != ''
    `)
    .all();

  if (!rows.length) {
    return;
  }

  const upsertLocation = db.prepare(`
    INSERT INTO locations (category, name)
    VALUES (?, ?)
    ON CONFLICT(category, name) DO NOTHING
  `);
  const getLocation = db.prepare(
    "SELECT id FROM locations WHERE category = ? AND name = ? LIMIT 1",
  );
  const upsertPatientLocation = db.prepare(`
    INSERT INTO patient_locations (patient_id, location_id)
    VALUES (?, ?)
    ON CONFLICT(patient_id, location_id) DO NOTHING
  `);

  const sync = db.transaction(() => {
    rows.forEach((row) => {
      const legacyLocation = String(row.location || "").trim();
      if (!legacyLocation) {
        return;
      }

      upsertLocation.run("Legacy Location", legacyLocation);
      const locationRecord = getLocation.get("Legacy Location", legacyLocation);
      if (locationRecord?.id) {
        upsertPatientLocation.run(row.id, locationRecord.id);
      }
    });
  });

  sync();
}

function getOrCreateDoctorRecord(account) {
  const existing = db
    .prepare("SELECT id FROM doctors WHERE full_name = ?")
    .get(account.full_name);

  if (existing) {
    db.prepare(`
      UPDATE doctors
      SET specialization = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `).run(account.specialization, existing.id);

    return Number(existing.id);
  }

  return Number(
    db
      .prepare(`
        INSERT INTO doctors (full_name, specialization, is_active)
        VALUES (?, ?, 1)
      `)
      .run(account.full_name, account.specialization).lastInsertRowid,
  );
}

function upsertSupportUser(user) {
  const existing =
    db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) ||
    db
      .prepare("SELECT id FROM users WHERE full_name = ? AND role = ?")
      .get(user.full_name, user.role);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET username = ?, full_name = ?, role = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `).run(user.username, user.full_name, user.role, existing.id);
    return Number(existing.id);
  }

  return Number(
    db
      .prepare(`
        INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
        VALUES (?, ?, ?, ?, NULL, 1)
      `)
      .run(user.username, user.full_name, user.role, hashPassword(DEFAULT_SEED_PASSWORD))
      .lastInsertRowid,
  );
}

function upsertDoctorUser(account, doctorId) {
  const existing =
    db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(account.username) ||
    db
      .prepare("SELECT id, password_hash FROM users WHERE full_name = ? AND role = 'doctor'")
      .get(account.full_name);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET username = ?, full_name = ?, role = 'doctor', doctor_id = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `).run(account.username, account.full_name, doctorId, existing.id);
    return Number(existing.id);
  }

  return Number(
    db
      .prepare(`
        INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
        VALUES (?, ?, 'doctor', ?, ?, 1)
      `)
      .run(
        account.username,
        account.full_name,
        hashPassword(DEFAULT_SEED_PASSWORD),
        doctorId,
      ).lastInsertRowid,
  );
}

function migrateLegacySeedDataIfNeeded() {
  const alreadySeeded = db.prepare("SELECT id FROM seed_control WHERE id = 1").get();

  if (alreadySeeded) {
    return;
  }

  const doctorCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM doctors").get().count,
  );
  const userCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
  );

  if (!doctorCount && !userCount) {
    return;
  }

  const hasLegacyDoctors = legacyDoctorNames.some((fullName, index) => {
    const legacyUsername = `doctor${String(index + 1).padStart(2, "0")}`;
    return Boolean(
      db.prepare("SELECT id FROM users WHERE username = ?").get(legacyUsername) ||
      db.prepare("SELECT id FROM doctors WHERE full_name = ?").get(fullName),
    );
  });

  if (!hasLegacyDoctors) {
    return;
  }

  const migrate = db.transaction(() => {
    doctorAccounts.forEach((account, index) => {
      const legacyUsername = `doctor${String(index + 1).padStart(2, "0")}`;
      const legacyDoctor = legacyDoctorNames[index];
      const legacyUser =
        db
          .prepare(`
            SELECT id, doctor_id
            FROM users
            WHERE username = ?
               OR (full_name = ? AND role = 'doctor')
            ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END
            LIMIT 1
          `)
          .get(legacyUsername, legacyDoctor, legacyUsername) ||
        db
          .prepare("SELECT id, doctor_id FROM users WHERE full_name = ? AND role = 'doctor'")
          .get(account.full_name);

      const legacyDoctorRow =
        (legacyUser?.doctor_id
          ? db.prepare("SELECT id FROM doctors WHERE id = ?").get(legacyUser.doctor_id)
          : null) ||
        db.prepare("SELECT id FROM doctors WHERE full_name = ?").get(legacyDoctor) ||
        db.prepare("SELECT id FROM doctors WHERE full_name = ?").get(account.full_name);

      let doctorId;

      if (legacyDoctorRow) {
        doctorId = Number(legacyDoctorRow.id);
        db.prepare(`
          UPDATE doctors
          SET full_name = ?, specialization = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `).run(account.full_name, account.specialization, doctorId);
      } else {
        doctorId = getOrCreateDoctorRecord(account);
      }

      if (legacyUser) {
        db.prepare(`
          UPDATE users
          SET username = ?, full_name = ?, role = 'doctor', doctor_id = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `).run(account.username, account.full_name, doctorId, legacyUser.id);
      } else {
        upsertDoctorUser(account, doctorId);
      }
    });

    doctorAccounts.slice(10).forEach((account) => {
      const doctorId = getOrCreateDoctorRecord(account);
      upsertDoctorUser(account, doctorId);
    });

    supportAccounts.forEach(upsertSupportUser);
    upsertSupportUser(adminAccount);

    db.prepare("INSERT OR IGNORE INTO seed_control (id) VALUES (1)").run();
  });

  migrate();
}

function seedDatabase() {
  const alreadySeeded = db.prepare("SELECT id FROM seed_control WHERE id = 1").get();

  if (alreadySeeded) {
    return;
  }

  const patientsCount = db.prepare("SELECT COUNT(*) AS count FROM patients").get().count;
  const appointmentsCount = db.prepare("SELECT COUNT(*) AS count FROM appointments").get().count;
  const labReportsCount = db.prepare("SELECT COUNT(*) AS count FROM lab_reports").get().count;

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      full_name,
      first_name,
      last_name,
      patient_identifier,
      patient_id_number,
      age,
      date_of_birth,
      gender,
      assigned_doctor_id,
      contact_number,
      patient_contact_number,
      contact_relationship,
      address,
      location,
      past_medical_history,
      past_surgical_history,
      drug_history,
      drug_allergy_history,
      particularity,
      consultation_notes,
      next_of_kin_name,
      next_of_kin_relationship,
      next_of_kin_contact_number,
      next_of_kin_email,
      next_of_kin_address,
      status,
      ongoing_treatment
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAppointment = db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertConsultation = db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertBilling = db.prepare(`
    INSERT INTO billing (
      consultation_id,
      patient_id,
      items,
      total_amount,
      status,
      payment_method,
      payment_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLabReport = db.prepare(`
    INSERT INTO lab_reports (
      patient_id,
      consultation_id,
      report_title,
      report_date,
      report_details,
      created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    doctorAccounts.forEach((account) => {
      const doctorId = getOrCreateDoctorRecord(account);
      upsertDoctorUser(account, doctorId);
    });

    supportAccounts.forEach(upsertSupportUser);
    upsertSupportUser(adminAccount);

    if (patientsCount === 0) {
      seededPatients.forEach((patient) =>
        insertPatient.run(
          buildPatientFullName(patient.first_name, patient.last_name),
          patient.first_name,
          patient.last_name,
          getNextPatientIdentifier(),
          String(patient.patient_id_number || "").trim().toUpperCase(),
          calculateAgeFromDateOfBirth(patient.date_of_birth),
          patient.date_of_birth,
          patient.gender,
          patient.assigned_doctor_name
            ? db.prepare("SELECT id FROM doctors WHERE full_name = ?").get(patient.assigned_doctor_name)?.id ?? null
            : null,
          patient.patient_contact_number,
          patient.patient_contact_number,
          patient.next_of_kin_relationship ?? "",
          patient.address,
          patient.location ?? "",
          patient.past_medical_history,
          patient.past_surgical_history,
          patient.drug_history ?? "",
          patient.drug_allergy_history,
          patient.particularity ?? "",
          patient.consultation_notes ?? "",
          patient.next_of_kin_name ?? "",
          patient.next_of_kin_relationship ?? "",
          patient.next_of_kin_contact_number ?? "",
          patient.next_of_kin_email ?? "",
          patient.next_of_kin_address ?? "",
          patient.status,
          patient.ongoing_treatment,
        ),
      );
    }

    if (appointmentsCount === 0) {
      const primaryDoctorId = db
        .prepare("SELECT id FROM doctors WHERE full_name = ?")
        .get(doctorAccounts[0].full_name)?.id;
      const secondDoctorId = db
        .prepare("SELECT id FROM doctors WHERE full_name = ?")
        .get(doctorAccounts[1].full_name)?.id;
      const thirdDoctorId = db
        .prepare("SELECT id FROM doctors WHERE full_name = ?")
        .get(doctorAccounts[2].full_name)?.id;

      const appointmentIds = [];
      appointmentIds.push(
        insertAppointment.run(1, primaryDoctorId, getTodayLocal(), "09:30", "scheduled")
          .lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(2, secondDoctorId, offsetLocalDate(2), "11:00", "scheduled")
          .lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(1, thirdDoctorId, offsetLocalDate(-1), "15:00", "completed")
          .lastInsertRowid,
      );
      appointmentIds.push(
        insertAppointment.run(2, primaryDoctorId, getTodayLocal(), "14:30", "completed")
          .lastInsertRowid,
      );

      const firstConsultationId = insertConsultation.run(
        appointmentIds[2],
        1,
        thirdDoctorId,
        offsetLocalDate(-1),
        "Patient reported a persistent rash on the forearm. Prescribed a topical steroid and advised a 10-day review.",
      ).lastInsertRowid;

      const secondConsultationId = insertConsultation.run(
        appointmentIds[3],
        2,
        primaryDoctorId,
        getTodayLocal(),
        "Follow-up consultation for fatigue and headaches. Ordered a CBC panel and advised hydration, rest, and a one-week follow-up.",
      ).lastInsertRowid;

      const paidItems = normalizeBillingItems([
        { description: "Dermatology Consultation", amount: 120 },
        { description: "Medication Guidance", amount: 25 },
      ]);
      const unpaidItems = normalizeBillingItems([
        { description: "General Consultation", amount: 95 },
        { description: "Lab Work Coordination", amount: 35 },
      ]);

      insertBilling.run(
        firstConsultationId,
        1,
        JSON.stringify(paidItems),
        calculateBillingTotal(paidItems),
        "paid",
        "cash",
        offsetLocalDate(-1),
      );

      insertBilling.run(
        secondConsultationId,
        2,
        JSON.stringify(unpaidItems),
        calculateBillingTotal(unpaidItems),
        "unpaid",
        null,
        null,
      );
    }

    if (labReportsCount === 0) {
      const sampleConsultation = db
        .prepare(`
          SELECT id, patient_id, consultation_date
          FROM consultations
          ORDER BY consultation_date DESC, created_at DESC
          LIMIT 1
        `)
        .get();

      if (sampleConsultation) {
        const labTechUserId = db
          .prepare("SELECT id FROM users WHERE username = ?")
          .get("labtech01")?.id ?? null;

        insertLabReport.run(
          sampleConsultation.patient_id,
          sampleConsultation.id,
          "CBC panel",
          sampleConsultation.consultation_date,
          "Hemoglobin stable. White cell count within normal range. Mild platelet elevation noted. Recommend routine clinical review alongside symptoms.",
          labTechUserId,
        );
      }
    }

    db.prepare("INSERT OR IGNORE INTO seed_control (id) VALUES (1)").run();
  });

  seed();
}

function ensureBillingForConsultation(consultationId, patientId) {
  const existingBill = db
    .prepare("SELECT id FROM billing WHERE consultation_id = ?")
    .get(consultationId);

  if (existingBill) {
    return existingBill.id;
  }

  const items = normalizeBillingItems([
    {
      description: "Consultation Fee",
      amount: 0,
    },
  ]);

  const insert = db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, payment_method)
    VALUES (?, ?, ?, ?, 'unpaid', NULL)
  `);

  const result = insert.run(
    consultationId,
    patientId,
    JSON.stringify(items),
    calculateBillingTotal(items),
  );

  return result.lastInsertRowid;
}

module.exports = {
  db,
  ensureBillingForConsultation,
  labReportAttachmentsDir,
  initializeDatabase,
};
