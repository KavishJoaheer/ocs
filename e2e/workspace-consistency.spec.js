import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const API=`http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF=`http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
test.use({ timezoneId:"Indian/Mauritius", actionTimeout:15000 });
async function session(page,request,role,width){
  const response=await request.post(`${API}/auth/login`,{data:{username:role==="doctor"?"arun.dharee":"operator01",password:"Welcome@123"}});
  expect(response.ok()).toBeTruthy(); const actor=await response.json();
  await page.addInitScript(token=>localStorage.setItem("ocs_medecins_auth_token",token),actor.token);
  await page.setViewportSize({width,height:900}); return actor;
}
async function fits(page){await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}

for(const width of [390,1440]){
  test(`operator starts on ongoing calls without resetting a chosen queue at ${width}px`,async({page,request})=>{
    await session(page,request,"operator",width);
    await page.route("**/api/teleconsultations",route=>route.fulfill({json:{requests:[{id:987,patient_id:150,patient_name:"Sample ongoing call",status:"assigned",doctor_name:"Arun Dharee",reason:"Medication review",current_location:"Moka",callback_number:"23057001122",created_at:new Date().toISOString(),accepted_at:new Date().toISOString()}]}}));
    await page.goto(`${STAFF}/teleconsultations`);
    await expect(page.getByRole("button",{name:/^In progress/})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByRole("button",{name:"Open request for Sample ongoing call",exact:true})).toBeVisible();
    await page.getByRole("button",{name:/^Needs attention/}).click();
    await expect(page.getByText("No requests need attention",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Refresh teleconsultations",exact:true}).click();
    await expect(page.getByRole("button",{name:/^Needs attention/})).toHaveAttribute("aria-pressed","true");
    await fits(page);
  });

  test(`legacy doctor screens keep updates compact and filters discoverable at ${width}px`,async({page,request},testInfo)=>{
    await session(page,request,"doctor",width);
    await page.route("**/api/health",route=>route.fulfill({json:{git_sha:"consistency-new-release"}}));
    for(const [path,title] of [["/hcm-news","HCM news"],["/stock-history","Stock history"],["/supply-requests","My Supply Requests"],["/live-report","Revenue Report"]]){
      await page.goto(STAFF+path);
      await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"App update available",exact:true})).toHaveCount(1);
      await expect(page.getByText("Notifications blocked on this device.",{exact:true})).toHaveCount(0);
      if(path==="/stock-history"&&width===390){
        await expect(page.getByLabel("From",{exact:true})).toBeHidden();
        await page.locator(".workspace-filter-panel > summary").click();
        await expect(page.getByLabel("From",{exact:true})).toBeVisible();
      }
      if(path==="/live-report"&&width===390){
        await expect(page.getByRole("heading",{name:"Visit volume",exact:true})).toBeHidden();
        await page.locator(".revenue-secondary > summary").click();
        await expect(page.getByRole("heading",{name:"Visit volume",exact:true})).toBeVisible();
      }
      await fits(page);
      await page.screenshot({path:testInfo.outputPath(`${width}-${path.slice(1)}.png`),animations:"disabled"});
    }
  });
}

test("doctor agenda scopes the schedule and consultation details preserve identity and unsaved notes",async({page,request},testInfo)=>{
  const doctor=await session(page,request,"doctor",1280);const db=openE2eDb();
  const today=db.prepare("SELECT date('now','+4 hours') value").get().value;
  const patient=Number(db.prepare("INSERT INTO patients(full_name,patient_identifier,patient_id_type,age,contact_number,address,location,assigned_doctor_id) VALUES('Schedule sample',?,'old_age',66,'57001122','Moka','Moka',?)").run(`UX-${Date.now()}`,doctor.user.doctor_id).lastInsertRowid);
  const appointments=[],consultations=[];
  try{
    for(const shift of [0,1]) appointments.push(Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES(?,?,date('now','+4 hours',?), '23:30','scheduled')").run(patient,doctor.user.doctor_id,`+${shift} days`).lastInsertRowid));
    const consultation=Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES(?,?,?,?, 'Private assessment recorded.')").run(appointments[0],patient,doctor.user.doctor_id,today).lastInsertRowid);consultations.push(consultation);
    await page.goto(`${STAFF}/appointments`);
    await expect(page.getByRole("button",{name:"Agenda",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByLabel("Schedule doctor")).toHaveValue(String(doctor.user.doctor_id));
    await expect(page.getByLabel("Schedule status")).toHaveValue("scheduled");
    const samples=page.getByRole("row").filter({hasText:"Schedule sample"});await expect(samples).toHaveCount(1);
    await page.getByRole("navigation",{name:"Agenda period"}).getByRole("button",{name:"Next 7 days",exact:true}).click();await expect(samples).toHaveCount(2);
    await page.getByRole("button",{name:"Calendar",exact:true}).click();await expect(page.locator(".appointment-calendar-day")).toHaveCount(42);
    await fits(page);await page.screenshot({path:testInfo.outputPath("doctor-agenda-calendar.png")});
    await page.route("**/api/health",route=>route.fulfill({json:{git_sha:"consultation-new-release"}}));
    await page.goto(`${STAFF}/consultations/${consultation}`);
    await expect(page.getByRole("heading",{level:1})).toContainText("Schedule sample");
    await expect(page.locator(".consultation-identity-strip")).toContainText("No identifier required");
    await expect(page.locator(".consultation-supporting-details")).not.toHaveAttribute("open","");
    await expect(page.getByText("Private assessment recorded.",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Edit consultation",exact:true}).click();
    await page.getByRole("textbox",{name:"Doctor notes (private)",exact:true}).fill("Unsaved clinical assessment.");
    await page.getByRole("button",{name:"App update available",exact:true}).click();
    await page.getByRole("dialog",{name:"App update available",exact:true}).getByRole("button",{name:"Reload requires confirmation",exact:true}).click();
    await expect(page.getByRole("button",{name:"Confirm reload",exact:true})).toBeVisible();
    await page.getByRole("dialog",{name:"App update available",exact:true}).getByRole("button",{name:"Later",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"Doctor notes (private)",exact:true})).toHaveValue("Unsaved clinical assessment.");
    await fits(page);await page.screenshot({path:testInfo.outputPath("doctor-consultation-details.png")});
  }finally{
    for(const id of consultations)db.prepare("DELETE FROM consultations WHERE id=?").run(id);
    for(const id of appointments)db.prepare("DELETE FROM appointments WHERE id=?").run(id);
    db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(patient);db.close();
  }
});

test("doctor patient scope is remembered without trapping an explicit cleared filter",async({page,request})=>{
  await session(page,request,"doctor",390);await page.goto(`${STAFF}/patients`);
  await page.getByRole("link",{name:"My patients",exact:true}).click();await expect(page).toHaveURL(/filter=my_assigned/);
  await page.goto(`${STAFF}/`);await page.goto(`${STAFF}/patients`);await expect(page).toHaveURL(/filter=my_assigned/);
  await page.getByRole("button",{name:"Clear my patients filter",exact:true}).click();
  await page.goto(`${STAFF}/`);await page.goto(`${STAFF}/patients`);await expect(page).not.toHaveURL(/filter=my_assigned/);
});
