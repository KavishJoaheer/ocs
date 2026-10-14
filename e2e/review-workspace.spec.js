import { test, expect } from "@playwright/test";
import { openE2eDb } from "./e2eDb.cjs";
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const patientIds = [];
test.use({ actionTimeout: 15_000 });

test.afterEach(() => {
  const db = openE2eDb();
  try {
    for (const id of patientIds) {
      db.prepare("DELETE FROM appointments WHERE patient_id=?").run(id);
      db.prepare("UPDATE patients SET deleted_at=CURRENT_TIMESTAMP,is_under_review=0 WHERE id=?").run(id);
    }
  } finally { patientIds.length = 0; db.close(); }
});

async function json(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function prepare(request) {
  const login = username => request.post(`${API}/auth/login`, { data: { username, password: "Welcome@123" } }).then(json);
  const doctor = await login("arun.dharee");
  const operator = await login("operator01");
  const dh = { Authorization: `Bearer ${doctor.token}` }, oh = { Authorization: `Bearer ${operator.token}` };
  const doctors = await json(await request.get(`${API}/doctors`, { headers: oh }));
  const otherDoctor = doctors.find(row => Number(row.id) !== Number(doctor.user.doctor_id) && row.is_active !== 0 && !row.deleted_at);
  const patients = {};
  for (const [key, name, date, time] of [
    ["overdue", "Asha Raman", "2026-10-11", "10:30"],
    ["today", "Ravi Pillay", "2026-10-14", "14:00"],
    ["soon", "Sarah Noel", "2026-10-17", "09:00"],
    ["later", "David Lall", "2026-11-03", ""],
    ["noDate", "Priya Devi", "", ""],
    ["oldYear", "Maya Raman", "2025-10-12", "11:00"],
    ["other", "Other Doctor Patient", "2026-10-14", "16:00"],
    ["unassigned", "Unassigned Patient", "", ""],
  ]) {
    const [first, ...last] = name.split(" ");
    const patient = await json(await request.post(`${API}/patients`, { headers: oh, data: {
      first_name: first, last_name: last.join(" "), gender: "F", patient_id_type: "old_age", patient_contact_number: "57001122",
      address: "Moka", location: "Moka", location_tags: [{ category: "Village", name: "Moka" }],
    }}));
    patientIds.push(patient.id);
    const assigned = key === "other" ? otherDoctor.id : key === "unassigned" ? null : doctor.user.doctor_id;
    const note = "Medication review following a recent consultation. Confirm progress, discuss the patient’s home readings and arrange the next review if needed. This full note must remain available.";
    const db = openE2eDb();
    db.prepare("UPDATE patients SET is_under_review=1,assigned_doctor_id=?,review_assigned_doctor_id=?,review_due_date=?,review_reason_note=?,review_appointment_time=? WHERE id=?").run(assigned,assigned,date,note,time,patient.id);
    db.close();
    patients[key] = { ...patient, full_name: name, date, time, note };
  }
  return { doctor, operator, dh, oh, otherDoctor, patients };
}
async function open(page, fixture, role, width=1440) {
  await page.clock.setFixedTime(new Date("2026-10-14T08:00:00Z"));
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), fixture[role].token);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
  await page.goto(`${STAFF}/${role}/long-term-review`);
  const workspace = page.getByRole("region", { name: "Review appointment workspace", exact: true });
  await expect(workspace.getByRole("article", { name: "Review for Asha Raman", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return workspace;
}
async function scopeSelect(page, workspace, width) {
  if (width < 1024) {
    await workspace.getByRole("button", { name: /^Filters/ }).click();
    return page.getByRole("dialog", { name: "Review filters", exact: true });
  }
  return workspace;
}
async function closeFilters(page, width) {
  if (width < 1024) await page.getByRole("dialog", { name: "Review filters", exact: true }).getByRole("button", { name: "Show reviews", exact: true }).click();
}

for (const role of ["doctor", "operator"]) for (const width of [320,390,820,1280,1440]) {
  test(`${role} review workspace stays compact and usable at ${width}px`, async ({ page, request }) => {
    const fixture = await prepare(request);
    const workspace = await open(page,fixture,role,width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review appointments");
    await expect(page.getByText("Notifications blocked on this device.", { exact: true })).toHaveCount(0);
    await expect(workspace.getByRole("article")).toHaveCount(role === "doctor" ? 6 : 8);
    const row = workspace.getByRole("article", { name: "Review for Asha Raman", exact: true });
    await expect(row).toContainText("11 Oct, 2026 · 10:30 AM");
    await expect(row).toContainText("Overdue 3d");
    if (role === "doctor") {
      await expect(row.getByText(/Dr Arun Dharee/)).toHaveCount(0);
      await expect(workspace.getByRole("button", { name: "Assign doctor/time", exact: true })).toHaveCount(0);
    } else {
      await expect(row.getByText("Dr Arun Dharee", { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Assign doctor/time", exact: true })).toBeVisible();
    }
    const details = row.locator("details");
    await expect(details).not.toHaveAttribute("open", "");
    if (role === "operator" && width <= 390) {
      const primary = await row.getByRole("button", { name: "Update review", exact: true }).boundingBox();
      const assignment = await row.getByRole("button", { name: "Assign doctor/time", exact: true }).boundingBox();
      expect(assignment.y).toBeCloseTo(primary.y, 0);
    }
    if ([320,390,1440].includes(width)) await page.screenshot({ path: `/tmp/ocs-review-updated-${role}-${width}.png`, fullPage:true });
    await details.locator("summary").focus(); await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details.getByText(fixture.patients.overdue.note, { exact:true })).toBeVisible();
    for (const element of [row.getByRole("button", { name:"Update review", exact:true }), row.getByRole("link", { name:"Open patient",exact:true }), details.locator("summary")]) {
      expect((await element.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    const last = workspace.getByRole("article").last().getByRole("link",{name:"Open patient",exact:true});
    await last.scrollIntoViewIfNeeded();
    if (width < 768) expect((await last.boundingBox()).y + (await last.boundingBox()).height).toBeLessThanOrEqual((await page.locator("#ocs-bottom-nav").boundingBox()).y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBeFalsy();
  });
}

for (const width of [390,1440]) test(`review search, urgency counts and month filters agree at ${width}px`,async({page,request})=>{
  const fixture=await prepare(request); const workspace=await open(page,fixture,"doctor",width);
  const filters=await scopeSelect(page,workspace,width);
  await filters.getByLabel("Review month",{exact:true}).selectOption("2025-10"); await closeFilters(page,width);
  await expect(workspace.getByRole("article")).toHaveCount(1);
  await expect(workspace.getByRole("button",{name:/^All/}).locator("span")).toHaveText("1");
  await expect(workspace.getByRole("button",{name:/^Overdue/}).locator("span")).toHaveText("1");
  await expect(workspace.getByRole("button",{name:/^Today/}).locator("span")).toHaveText("0");
  await expect(workspace.getByRole("article",{name:"Review for Maya Raman",exact:true})).toBeVisible();
  await workspace.getByLabel("Search review patients",{exact:true}).fill("Asha");
  await expect(workspace.getByRole("article")).toHaveCount(0);
  await expect(workspace.getByRole("heading",{name:"No matching reviews",exact:true})).toBeVisible();
  await workspace.getByRole("button",{name:"Clear filters",exact:true}).click();
  await expect(workspace.getByRole("article")).toHaveCount(6);
  await workspace.getByLabel("Search review patients",{exact:true}).fill(fixture.patients.overdue.patient_identifier);
  await expect(workspace.getByRole("article")).toHaveCount(1);
  await workspace.getByRole("button",{name:"Clear review search",exact:true}).click();
  await workspace.getByRole("button",{name:/^Today/}).click(); await expect(workspace.getByRole("article")).toHaveCount(1);
  await workspace.getByRole("button",{name:/^Next 7 days/}).click(); await expect(workspace.getByRole("article")).toHaveCount(2);
});

for (const [role,width] of [["doctor",1440],["operator",390]]) test(`${role} can reschedule, complete and cancel reviews at ${width}px`,async({page,request})=>{
  const fixture=await prepare(request); const workspace=await open(page,fixture,role,width);
  async function update(key,action,date) {
    const patient=fixture.patients[key];
    await workspace.getByRole("article",{name:`Review for ${patient.full_name}`,exact:true}).getByRole("button",{name:"Update review",exact:true}).click();
    const modal=page.getByRole("dialog",{name:"Update review",exact:true});
    await modal.getByRole("button",{name:action,exact:true}).click();
    if(date) { await modal.getByLabel(action==="Reschedule"?"Target review date":"Next review date",{exact:true}).fill(date); await modal.getByLabel("Review note").fill("Patient contacted and new review agreed."); }
    const response=page.waitForResponse(r=>r.url().includes(`/patients/${patient.id}/long-term-review`)&&r.request().method()==="PATCH");
    await modal.getByRole("button",{name:"Save update",exact:true}).click(); const saved=await json(await response); await expect(modal).toBeHidden(); return saved;
  }
  const rescheduled=await update("overdue","Reschedule","2026-10-29"); expect(rescheduled.review_due_date).toBe("2026-10-29");
  const row=workspace.getByRole("article",{name:"Review for Asha Raman",exact:true}); await expect(row).toContainText("29 Oct, 2026 · 10:30 AM");
  const next=await update("today","Complete and schedule next","2026-11-14"); expect(next.is_under_review).toBe(true); expect(next.review_due_date).toBe("2026-11-14");
  const complete=await update("soon","Complete review"); expect(complete.is_under_review).toBe(false); await expect(workspace.getByRole("article",{name:"Review for Sarah Noel",exact:true})).toHaveCount(0);
  const cancelled=await update("later","Cancel review"); expect(cancelled.is_under_review).toBe(false); await expect(workspace.getByRole("article",{name:"Review for David Lall",exact:true})).toHaveCount(0);
});

for(const width of [390,1440]) test(`operator can assign a review doctor and time without changing the regular doctor at ${width}px`,async({page,request})=>{
  const fixture=await prepare(request); const workspace=await open(page,fixture,"operator",width);
  const row=workspace.getByRole("article",{name:"Review for Ravi Pillay",exact:true});
  await row.getByRole("button",{name:"Assign doctor/time",exact:true}).click();
  const modal=page.getByRole("dialog",{name:"Assign doctor/time",exact:true});
  await modal.getByRole("button",{name:"Assign doctor",exact:true}).click();
  await modal.getByRole("combobox").selectOption(String(fixture.otherDoctor.id));
  let response=page.waitForResponse(r=>r.url().includes(`/patients/${fixture.patients.today.id}/review-assignment`)&&r.request().method()==="PATCH");
  await modal.getByRole("button",{name:"Save assignment",exact:true}).click(); const saved=await json(await response);
  expect(saved.assigned_doctor_id).toBe(fixture.doctor.user.doctor_id); expect(saved.review_assigned_doctor_id).toBe(fixture.otherDoctor.id);
  await expect(modal).toBeHidden(); await row.getByRole("button",{name:"Assign doctor/time",exact:true}).click();
  await modal.getByRole("button",{name:"Set appointment time",exact:true}).click();
  await modal.getByLabel("Time of appointment",{exact:true}).fill("15:45");
  response=page.waitForResponse(r=>r.url().includes(`/patients/${fixture.patients.today.id}/review-assignment`)&&r.request().method()==="PATCH");
  await modal.getByRole("button",{name:"Save assignment",exact:true}).click(); expect((await json(await response)).review_appointment_time).toBe("15:45");
  await expect(modal).toBeHidden(); await expect(row).toContainText("14 Oct, 2026 · 3:45 PM");
  const denied=await request.patch(`${API}/patients/${fixture.patients.today.id}/review-assignment`,{headers:fixture.dh,data:{review_appointment_time:"16:00"}}); expect(denied.status()).toBe(403);
});

test("review doctor filters ignore delayed results and preserve view-only access",async({page,request})=>{
  const fixture=await prepare(request); const workspace=await open(page,fixture,"doctor");
  let release; const held=new Promise(resolve=>{release=resolve;});
  await page.route("**/api/dashboard/long-term-review?*",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("reviewDoctorId")===String(fixture.otherDoctor.id)) {const result=await route.fetch();await held;await route.fulfill({response:result});} else await route.continue();
  });
  try {
    const oldRequest=page.waitForRequest(r=>new URL(r.url()).searchParams.get("reviewDoctorId")===String(fixture.otherDoctor.id));
    await workspace.getByLabel("Review doctor",{exact:true}).selectOption(String(fixture.otherDoctor.id)); await oldRequest;
    await workspace.getByLabel("Review doctor",{exact:true}).selectOption("all");
    await expect(workspace.getByRole("article")).toHaveCount(8);
    const oldResponse=page.waitForResponse(r=>new URL(r.url()).searchParams.get("reviewDoctorId")===String(fixture.otherDoctor.id)); release(); await oldResponse;
    await expect(workspace.getByRole("article")).toHaveCount(8);
    const other=workspace.getByRole("article",{name:"Review for Other Doctor Patient",exact:true});
    await expect(other.getByText("View only",{exact:true})).toBeVisible(); await expect(other.getByRole("button",{name:"Update review",exact:true})).toHaveCount(0);
    await workspace.getByLabel("Search review patients",{exact:true}).fill("Asha");
    await workspace.getByLabel("Review doctor",{exact:true}).selectOption("mine");
    await expect(workspace.getByRole("article")).toHaveCount(1); await expect(workspace.getByLabel("Search review patients",{exact:true})).toHaveValue("Asha");
  } finally {release();}
});

test("review refresh keeps records visible and offers retry after an error",async({page,request})=>{
  const fixture=await prepare(request); const workspace=await open(page,fixture,"doctor");
  await page.route("**/api/dashboard/long-term-review",route=>route.fulfill({status:503,json:{error:"Reviews temporarily unavailable. Please retry."}}),{times:1});
  await workspace.getByLabel("Refresh review appointments",{exact:true}).click();
  await expect(workspace.getByRole("alert")).toContainText("Reviews temporarily unavailable"); await expect(workspace.getByRole("article")).toHaveCount(6);
  await workspace.getByRole("button",{name:"Retry",exact:true}).click(); await expect(workspace.getByRole("alert")).toHaveCount(0); await expect(workspace.getByRole("article")).toHaveCount(6);
});

test("small review header keeps update and notification controls accessible", async ({ page, request }) => {
  const fixture = await prepare(request);
  await page.route("**/api/health", route => route.fulfill({ json: { status: "ok", git_sha: "available-review-update" } }));
  const workspace = await open(page, fixture, "operator", 320);
  const update = workspace.getByRole("button", { name: "App update available", exact: true });
  await expect(update).toBeVisible();
  const heading = await workspace.getByRole("heading", { level: 1 }).boundingBox();
  const controls = await update.boundingBox();
  expect(heading.y + heading.height).toBeLessThanOrEqual(controls.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBeFalsy();
  await page.screenshot({ path: "/tmp/ocs-review-updated-320-with-update.png" });
  await update.click();
  await expect(page.getByRole("dialog", { name: "App update available", exact: true })).toBeVisible();
});

test("initial review failure shows unavailable counts and supports recovery", async ({ page, request }) => {
  const fixture = await prepare(request);
  let unavailable = true;
  await page.route("**/api/dashboard/long-term-review", route => unavailable ? route.fulfill({ status: 503, json: { error: "Review queue unavailable." } }) : route.continue());
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), fixture.doctor.token);
  await page.goto(`${STAFF}/doctor/long-term-review`);
  const workspace = page.getByRole("region", { name: "Review appointment workspace", exact: true });
  await expect(workspace.getByText(/Reviews unavailable/)).toBeVisible();
  await expect(workspace.getByRole("button", { name: /^All/ }).locator("span")).toHaveText("—");
  unavailable = false;
  await workspace.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(workspace.getByRole("article")).toHaveCount(6);
  await expect(workspace.getByRole("alert")).toHaveCount(0);
});
