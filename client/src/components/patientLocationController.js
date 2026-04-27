/**
 * Controller extensions for handling patient tags / locations multi-select.
 */

const updatePatientTags = (db, patientId, tags) => {
  // `tags` expects an array of objects: [{ category: 'Clinic', name: 'Medic World' }, ...]
  
  const deleteStmt = db.prepare(`DELETE FROM patient_locations WHERE patient_id = ?`);
  
  const insertLocStmt = db.prepare(`
    INSERT INTO locations (category, name) 
    VALUES (?, ?) 
    ON CONFLICT(category, name) DO NOTHING
  `);
  
  const getLocStmt = db.prepare(`SELECT id FROM locations WHERE category = ? AND name = ?`);
  const insertLinkStmt = db.prepare(`INSERT INTO patient_locations (patient_id, location_id) VALUES (?, ?)`);

  // Wrap updates in a transaction for data consistency
  const transaction = db.transaction((pId, newTags) => {
    deleteStmt.run(pId);
    
    for (const tag of newTags) {
      insertLocStmt.run(tag.category, tag.name);
      const loc = getLocStmt.get(tag.category, tag.name);
      if (loc) {
        insertLinkStmt.run(pId, loc.id);
      }
    }
  });

  transaction(patientId, tags);
};

const getPatientTags = (db, patientId) => {
  const stmt = db.prepare(`
    SELECT l.category, l.name 
    FROM patient_locations pl
    JOIN locations l ON pl.location_id = l.id
    WHERE pl.patient_id = ?
  `);
  return stmt.all(patientId);
};

/* 
 * Security Note:
 * To respect task 4 permissions, make sure you integrate `updatePatientTags` inside your Express route
 * enforcing Operator (with specific temporary edit rights), Doctor, or Admin roles just as your current
 * `PUT /api/patients/:id` workflow dictates.
 */

module.exports = { updatePatientTags, getPatientTags };