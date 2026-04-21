# OCS Medecins Role Capabilities

Current application behavior as implemented in the codebase on `2026-04-14`.

## Seeded Access

- Admin: `shravan.joaheer` (`Dr Shravan Kumar Joaheer`)
- Doctors: 15 seeded doctor accounts
- Operators: 3 seeded operator accounts
- Lab Tech: 1 seeded lab tech account
- Accountant: 1 seeded accountant account
- Default seeded password: `Welcome@123`
- The default password can be overridden with the `SEED_USER_PASSWORD` environment variable.

## Shared System Rules

- The app uses role-based access control.
- Every seeded user can sign in and land in a role-specific workspace.
- The SQLite database is auto-created on first run.
- Patients have two separate identifiers:
  - `OCS care number`: auto-generated in the `OCS-150+` format
  - `Patient ID`: national ID card number or passport number
- `OCS care number` is editable by admin only.
- The assigned doctor is locked after patient creation.
- Creating a consultation automatically creates a linked billing record.
- Patient deletion is allowed only when the patient has no linked appointments, consultations, or bills.
- Temporary operator edit access is managed by admin from the dashboard.

## Current Patient Registration Rules

- Required fields in the current add-patient flow:
  - Patient name
  - Gender
  - Patient contact number
  - Address
  - Assigned doctor for admin and operator
- Doctor-created patients are automatically assigned to the logged-in doctor.
- `Date of birth` is supported and age is auto-derived when DOB is present.
- `Location` is available as a Mauritius dropdown.
- `Patient ID` is currently optional, but if filled it must be unique.
- `Registration consultation note` is not entered in the add-patient modal anymore.
- The registration consultation note is edited from the patient profile view page.

## Page Access Matrix

| Area | Admin | Doctor | Operator | Lab Tech | Accountant |
|---|---|---|---|---|---|
| Dashboard | Yes | Yes | Yes | Yes | Yes |
| Operator access panel on dashboard | Yes | No | No | No | No |
| Patients list | Yes | Yes | Yes | Yes | No |
| Patient profile | Yes | Yes | Yes | Yes | No |
| Appointments | Yes | Yes | No | No | No |
| Consultations list | Yes | Yes | No | Yes | No |
| Consultation detail page | Yes | Yes | No | Yes | No |
| Lab workspace | Yes | No | No | Yes | No |
| Billing | Yes | No | No | No | Yes |
| Inventory | Yes | Yes | No | Yes | No |
| Doctors management | Yes | No | No | No | No |

## Admin

### Current Functionality

- Full dashboard access, including the operator access control panel.
- Can grant and revoke temporary operator edit access for specific patients.
- Can view all patients and open every patient profile.
- Can add patients and choose the assigned doctor during creation.
- Can edit all patient records.
- Can edit the `OCS care number`.
- Can edit the `Patient ID`.
- Can edit the registration consultation note on the patient profile.
- Can delete a patient if there are no linked clinical or billing records.
- Can view and manage doctor accounts.
- Can add doctor accounts.
- Can edit doctor names, usernames, specialization, and reset doctor passwords.
- Can deactivate doctor access.
- Can create, edit, delete, and change statuses for appointments.
- Can view all consultations.
- Can create and edit consultations.
- Can open dedicated consultation detail pages.
- Can add and edit lab reports.
- Can view and manage all billing records.
- Can edit bill line items, change billing status, and mark bills as paid.
- Can use full inventory CRUD.

### Current Limitations

- Cannot reassign a patient to a different doctor after the patient is created.
- Cannot delete a patient once that patient has linked appointments, consultations, or bills.
- Does not currently have a dedicated UI to manage operator, lab tech, or accountant accounts.
- Does not currently have a dedicated UI to manage admin accounts.

## Doctor

### Current Functionality

- Dashboard access.
- Can view all patients.
- Can open all patient profiles.
- Can add patients.
- New patients created by a doctor are automatically assigned to that doctor.
- Can edit patient records.
- Can edit the registration consultation note from the patient profile.
- Can view the appointments page.
- Can view only their own appointments on the appointments page.
- Can update the status of their own appointments.
- Can view the consultations list.
- Can see only their own consultations on the consultations page.
- Can create consultations from their own available appointments.
- Can add consultations directly from the patient profile.
- Can edit only their own consultation notes.
- Can open their own consultation detail pages.
- Can view and manage inventory.
- Can add and edit lab reports for patients assigned to their doctor profile.

### Current Limitations

- Cannot choose a different assigned doctor when creating a patient.
- Cannot change the assigned doctor after patient creation.
- Cannot edit the `OCS care number`.
- Cannot delete patients.
- Cannot create full appointment records from the appointments page.
- Cannot fully edit or delete appointment records.
- Cannot edit another doctor's consultation from the consultations module.
- Cannot open another doctor's consultation detail page.
- Cannot access billing pages.
- Cannot manage doctor accounts.
- Cannot manage dashboard operator access.
- Cannot add or edit lab reports for patients not assigned to their doctor profile.

## Operator

### Current Functionality

- Dashboard access.
- Can view all patients.
- Can open patient profiles and review appointments, consultations, lab reports, and billing history in read-only mode.
- Can add patients at any time.
- Must choose the assigned doctor when creating a patient.
- Can edit a patient only when admin has granted temporary operator access for that patient.

### Current Limitations

- Cannot edit patients by default.
- Cannot delete patients.
- Cannot edit the `OCS care number`.
- Cannot manage operator access.
- Cannot access appointments.
- Cannot access consultations list or consultation detail pages.
- Cannot add or edit consultations.
- Cannot add or edit lab reports.
- Cannot access billing.
- Cannot access inventory.
- Cannot manage doctors.

## Lab Tech

### Current Functionality

- Dashboard access.
- Can view patients and patient profiles in read-only mode.
- Can access the consultations list.
- Can open consultation detail pages in read-only mode.
- Can access the lab workspace queue.
- Can add and edit lab reports from patient profiles.
- Can manage inventory.

### Current Limitations

- Cannot add patients.
- Cannot edit patient demographic or clinical profile data.
- Cannot delete patients.
- Cannot access the appointments page.
- Cannot create or edit consultations.
- Cannot access billing pages.
- Cannot manage doctors.
- Cannot manage operator access.

## Accountant

### Current Functionality

- Dashboard access.
- Can access billing.
- Can view all bills.
- Can filter bills by payment status.
- Can edit bill line items.
- Can change bill status.
- Can mark bills as paid.
- Can view the per-patient billing summary.

### Current Limitations

- Cannot access patients.
- Cannot open patient profiles.
- Cannot access appointments.
- Cannot access consultations.
- Cannot access lab workspace.
- Cannot access inventory.
- Cannot manage doctors.
- Cannot manage operator access.

## Important Current Workflow Notes

- Doctors can see all patient profiles, but doctor-only API actions are still restricted in some places.
- Consultation visibility is split:
  - Doctors see all consultations on patient profiles.
  - Doctors see only their own consultations in the consultations module.
  - Doctors can only edit their own consultations.
- Lab report access is split:
  - Admin and lab tech can manage lab reports broadly.
  - Doctors can only manage lab reports for patients assigned to them.
- Appointment management is split:
  - Admin manages full appointment CRUD.
  - Doctors mainly work with their own appointment statuses.

## Current Known Product Gaps

- No UI yet for managing operator, lab tech, or accountant accounts.
- No UI yet for changing the assigned doctor after patient registration.
- No self-service password change flow for non-admin users.
- No dedicated admin settings area yet.
- No role-specific audit document inside the main README yet. This file is the standalone reference for now.
