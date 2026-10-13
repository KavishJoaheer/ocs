import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const patientIds = [], requestIds = [];
test.use({ actionTimeout: 15_000 });
test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of requestIds) db.prepare("DELETE FROM teleconsultation_requests WHERE id=?").run(id);
    for (const id of patientIds) db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  } finally { db.close(); patientIds.length=0; requestIds.length=0; }
});
async function createRequest(request, actor, headers, doctor, first, last, status, accepted, age, reason = "Discuss recent test results", location = "Moka") {
  const created = await request.post(`${API}/patients`, { headers, data: { first_name:first,last_name:last,gender:"F",patient_id_type:"old_age",patient_contact_number:"57001122",address:location,location,location_tags:[{category:"Village",name:location}] } });
  expect(created.ok(),await created.text()).toBeTruthy();
  const patient=await created.json(); patientIds.push(patient.id);
  const db=openE2eDb();
  try {
    const patientUser=db.prepare("INSERT INTO patient_users (patient_id,full_name,phone) VALUES (?,?,?)").run(patient.id,patient.full_name,"57001122").lastInsertRowid;
    const id=Number(db.prepare(`INSERT INTO teleconsultation_requests (patient_id,patient_user_id,reason,current_location,callback_number,status,consultation_code,consent_version,consent_snapshot,assigned_doctor_id,accepted_by,accepted_at,created_at) VALUES (?,?,?,?,?,?,'123456','2026-10-13-v1','[]',?,?,?,datetime('now',?))`).run(patient.id,patientUser,reason,location,"23057001122",status,status === "pending" ? null : doctor.id,accepted?actor.user.id:null,accepted?new Date().toISOString():null,`-${age} minutes`).lastInsertRowid);
    requestIds.push(id); return { id, name:patient.full_name };
  } finally { db.close(); }
}
async function prepare(page,request) {
  const login=await request.post(`${API}/auth/login`,{data:{username:"operator01",password:"Welcome@123"}});
  expect(login.ok()).toBeTruthy();const actor=await login.json();const headers={Authorization:`Bearer ${actor.token}`};
  await page.addInitScript(token=>localStorage.setItem("ocs_medecins_auth_token",token),actor.token);
  const db=openE2eDb();const doctor=db.prepare("SELECT d.id,d.full_name FROM doctors d JOIN users u ON u.doctor_id=d.id WHERE d.deleted_at IS NULL AND d.is_active=1 AND u.role='doctor' AND u.is_active=1 AND u.deleted_at IS NULL ORDER BY d.full_name LIMIT 1").get();db.close();
  const create=(...values)=>createRequest(request,actor,headers,doctor,...values);
  const priya=await create("Priya","Bissoon","pending",true,20,"Discuss recent test results","Phoenix");
  const amelia=await create("Amelia","Marie Ramgoolam","pending",false,18,"Fever and persistent cough since yesterday","Quatre Bornes");
  await create("Ravi","Pillay","pending",false,7,"Back pain after lifting a heavy box");
  const david=await create("David","Wong","assigned",true,35,"Persistent cough for three days","Vacoas");
  await create("Marie","Joseph","in_consultation",true,50,"Medication review and ongoing headache","Beau Bassin");
  await create("Previous","Patient","cancelled",true,90,"Previous cancelled request");
  return { headers,doctor,priya,amelia,david,create };
}
function panel(page,width) { return page.getByRole(width<1024?"dialog":"complementary",{name:"Request details",exact:true}); }
function queue(page) { return page.getByRole("list",{name:"Teleconsultation request queue",exact:true}); }
function row(page,name) { return queue(page).getByRole("article",{name:`Teleconsultation for ${name}`,exact:true}); }
async function open(page,name) { await row(page,name).getByRole("button",{name:`Open request for ${name}`,exact:true}).click(); }

for (const width of [360,430,820,1440]) {
  test(`operator teleconsultation acceptance, assignment and history at ${width}px`,async({page,request})=>{
    const {doctor,amelia}=await prepare(page,request);
    await page.setViewportSize({width,height:932});await page.goto(`${STAFF}/teleconsultations`);
    await expect(page.getByRole("heading",{name:"Teleconsultations",exact:true,level:1})).toBeVisible();
    await expect(page.getByRole("complementary",{name:"Teleconsultation request alerts",exact:true})).toHaveCount(0);
    await expect(queue(page).getByRole("listitem")).toHaveCount(3);
    await expect(queue(page).getByRole("listitem").first()).toContainText("Priya Bissoon");
    await expect(page.getByRole("button",{name:"Needs attention 3",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByRole("button",{name:"Needs attention 3",exact:true})).toHaveCSS("background-color","rgb(19, 123, 128)");
    await expect(page.getByLabel("Filter by status",{exact:true})).toBeHidden();
    await expect(page.getByRole("region",{name:"Operator teleconsultations",exact:true}).getByRole("link",{name:"Add patient",exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for(const box of await queue(page).getByRole("article").evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{left:b.left,right:b.right};}))) {expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);}
    await page.screenshot({path:`/tmp/ocs-operator-teleconsultations-${width}.png`,fullPage:true});
    await page.screenshot({path:`/tmp/ocs-operator-teleconsultations-viewport-${width}.png`});
    await page.route(`**/api/teleconsultations/${amelia.id}/accept`,route=>route.fulfill({status:503,json:{error:"Acceptance unavailable. Please retry."}}),{times:1});
    await row(page,amelia.name).getByRole("button",{name:`Accept request for ${amelia.name}`,exact:true}).click();
    await expect(row(page,amelia.name).getByRole("alert")).toHaveText("Acceptance unavailable. Please retry.");
    await expect(row(page,amelia.name).getByText("Awaiting acceptance",{exact:true})).toBeVisible();
    await row(page,amelia.name).getByRole("button",{name:`Accept request for ${amelia.name}`,exact:true}).click();
    const details=panel(page,width);
    await expect(details.getByRole("group",{name:"Assign a doctor",exact:true})).toBeVisible();
    await expect(details.getByText("Awaiting doctor",{exact:true})).toBeVisible();
    await expect(details.getByText("123456",{exact:true})).toBeVisible();
    await expect(details.getByRole("link",{name:`Call ${amelia.name}`,exact:true})).toHaveAttribute("href","tel:+23057001122");
    await details.getByLabel("Assign doctor",{exact:true}).selectOption(String(doctor.id));
    const refreshed=page.waitForResponse(response=>response.url().endsWith("/api/teleconsultations")&&response.request().method()==="GET");
    await page.evaluate(()=>window.dispatchEvent(new Event("patients-live-updated")));await refreshed;
    await expect(details.getByLabel("Assign doctor",{exact:true})).toHaveValue(String(doctor.id));
    if(width<1024)await details.getByRole("button",{name:"Close dialog",exact:true}).click();else await open(page,"Ravi Pillay");
    await expect(page.getByRole("dialog",{name:"Discard teleconsultation changes?",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Continue editing",exact:true}).click();
    await page.route(`**/api/teleconsultations/${amelia.id}/assign`,route=>route.fulfill({status:503,json:{error:"Assignment unavailable. Please retry."}}),{times:1});
    await details.getByRole("button",{name:"Assign doctor",exact:true}).click();
    await expect(details.getByRole("alert")).toHaveText("Assignment unavailable. Please retry.");
    await expect(details.getByLabel("Assign doctor",{exact:true})).toHaveValue(String(doctor.id));
    await details.getByRole("button",{name:"Assign doctor",exact:true}).click();
    await expect(details.getByText("Doctor assigned",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"In progress 3",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(details.getByRole("button",{name:"Verify code & begin consultation",exact:true})).toHaveCount(0);
    await expect(details.getByText("Consultation record",{exact:true})).toHaveCount(0);
    await details.getByText("More actions",{exact:true}).click();
    await details.getByLabel("Patient-facing reason",{exact:true}).fill("Patient requested cancellation");
    await details.getByLabel("Next step for patient",{exact:true}).fill("Call OCS to arrange another consultation");
    await page.route(`**/api/teleconsultations/${amelia.id}/close`,route=>route.fulfill({status:503,json:{error:"Cancellation unavailable. Please retry."}}),{times:1});
    await details.getByRole("button",{name:"Cancel request",exact:true}).click();
    await expect(details.getByRole("alert")).toHaveText("Cancellation unavailable. Please retry.");
    await expect(details.getByLabel("Patient-facing reason",{exact:true})).toHaveValue("Patient requested cancellation");
    await details.getByRole("button",{name:"Cancel request",exact:true}).click();
    await expect(details.getByText("Cancelled",{exact:true})).toBeVisible();
    await expect(details.getByText("Call OCS to arrange another consultation",{exact:false})).toBeVisible();
    await expect(details.getByText("123456",{exact:true})).toHaveCount(0);
    if(width<1024)await details.getByRole("button",{name:"Close dialog",exact:true}).click();
    await page.getByRole("button",{name:"History",exact:true}).click();
    await page.getByLabel("Search teleconsultations",{exact:true}).fill(amelia.name);
    await expect(queue(page).getByRole("listitem")).toHaveCount(1);
    await open(page,amelia.name);
    await expect(details.getByRole("button",{name:"Cancel request",exact:true})).toHaveCount(0);
    if(width<1024)await details.getByRole("button",{name:"Close dialog",exact:true}).click();
    await page.getByRole("button",{name:"Filters",exact:true}).click();
    await page.getByLabel("Filter by status",{exact:true}).selectOption("completed");
    await expect(page.getByRole("heading",{name:"No matching requests",exact:true})).toBeVisible();
    await page.getByLabel("Filter by status",{exact:true}).selectOption("all");
    await expect(queue(page).getByRole("listitem")).toHaveCount(1);
  });
}

test("teleconsultation deep links, live requests, conflict recovery and stale errors",async({page,request})=>{
  const {david,priya,create}=await prepare(page,request);
  await page.setViewportSize({width:390,height:932});await page.goto(`${STAFF}/teleconsultations?request=${david.id}`);
  const details=panel(page,390);
  await expect(details.getByRole("link",{name:david.name,exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"In progress 2",exact:true})).toHaveAttribute("aria-pressed","true");
  await details.getByRole("button",{name:"Close dialog",exact:true}).click();
  await page.getByRole("button",{name:"Needs attention 3",exact:true}).click();
  await open(page,priya.name);await details.getByText("More actions",{exact:true}).click();
  await details.getByLabel("Patient-facing reason",{exact:true}).fill("Unsaved coordination note");
  await page.setViewportSize({width:1440,height:932});
  await expect(panel(page,1440).getByLabel("Patient-facing reason",{exact:true})).toHaveValue("Unsaved coordination note");
  await page.setViewportSize({width:390,height:932});
  await expect(details.getByLabel("Patient-facing reason",{exact:true})).toHaveValue("Unsaved coordination note");
  const incoming=await create("New","Patient","pending",false,0,"A new patient request");
  const updated=page.waitForResponse(response=>response.url().endsWith("/api/teleconsultations"));
  await page.evaluate(()=>window.dispatchEvent(new Event("patients-live-updated")));await updated;
  await expect(details.getByLabel("Patient-facing reason",{exact:true})).toHaveValue("Unsaved coordination note");
  await expect(row(page,incoming.name)).toBeVisible();
  await details.getByRole("button",{name:"Close dialog",exact:true}).click();
  await page.getByRole("button",{name:"Discard changes",exact:true}).click();
  await open(page,priya.name);await details.getByText("More actions",{exact:true}).click();
  await expect(details.getByLabel("Patient-facing reason",{exact:true})).toHaveValue("");
  await details.getByRole("button",{name:"Close dialog",exact:true}).click();
  // Another operator has already accepted this request: refresh the stage after a conflict.
  const db=openE2eDb();db.prepare("UPDATE teleconsultation_requests SET accepted_at=CURRENT_TIMESTAMP WHERE id=?").run(incoming.id);db.close();
  await page.route(`**/api/teleconsultations/${incoming.id}/accept`,route=>route.fulfill({status:409,json:{error:"Already accepted by another operator"}}),{times:1});
  await row(page,incoming.name).getByRole("button",{name:`Accept request for ${incoming.name}`,exact:true}).click();
  await expect(row(page,incoming.name).getByText("Awaiting doctor",{exact:true})).toBeVisible();
  await expect(row(page,incoming.name).getByRole("button",{name:`Accept request for ${incoming.name}`,exact:true})).toHaveCount(0);
  await page.route("**/api/teleconsultations",route=>route.fulfill({status:503,json:{error:"Live requests unavailable"}}));
  await page.getByRole("button",{name:"Refresh teleconsultations",exact:true}).click();
  await expect(page.getByText("Connection issue",{exact:true})).toBeVisible();
  await expect(page.getByText(/Showing the last loaded requests/)).toBeVisible();
  await expect(queue(page).getByRole("listitem")).toHaveCount(4);
  await page.unroute("**/api/teleconsultations");await page.getByRole("button",{name:"Retry teleconsultations",exact:true}).click();
  await expect(page.getByText("Connection issue",{exact:true})).toHaveCount(0);
});

test("operator assignment recovers doctor lookup errors and training mode blocks writes",async({page,request})=>{
  const {priya}=await prepare(page,request);
  await page.setViewportSize({width:1440,height:932});
  await page.route("**/api/doctors",route=>route.fulfill({status:503,json:{error:"Doctors unavailable"}}));
  await page.goto(`${STAFF}/teleconsultations?request=${priya.id}`);
  const details=panel(page,1440);
  await expect(details.getByRole("alert")).toContainText("Doctor list unavailable");
  await page.unroute("**/api/doctors");await details.getByRole("button",{name:"Retry doctor list",exact:true}).click();
  await expect(details.getByLabel("Assign doctor",{exact:true}).locator("option")).not.toHaveCount(1);
  await page.route("**/api/auth/me",async route=>{const response=await route.fetch();const data=await response.json();data.user.is_read_only=true;await route.fulfill({response,json:data});});
  await page.reload();
  await expect(details.getByLabel("Assign doctor",{exact:true})).toBeDisabled();
  await expect(details.getByRole("button",{name:"Assign doctor",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:/^Accept request for/})).toHaveCount(0);
});
