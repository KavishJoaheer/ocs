import { test, expect } from "@playwright/test";
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || "3001"}/api`;
const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
async function json(response) { expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function prepare(request) {
  const doctor = await json(await request.post(`${API}/auth/login`, { data: { username: "arun.dharee", password: "Welcome@123" } }));
  const operator = await json(await request.post(`${API}/auth/login`, { data: { username: "operator01", password: "Welcome@123" } }));
  const oh = { Authorization: `Bearer ${operator.token}` }, dh = { Authorization: `Bearer ${doctor.token}` };
  const catalogue = await json(await request.get(`${API}/inventory`, { headers: oh }));
  const prefix = `Supply ${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const items = [];
  for (const name of ["Sterile gauze", "Examination gloves", "Alcohol swabs", "Fourth item syringe"]) {
    const itemName = `${prefix} ${name}`;
    const created = await json(await request.post(`${API}/inventory/items`, { headers: oh, data: { item_name: itemName, folder_id: catalogue.folders.find(f => f.name === "Consumable").id, quantity: 0, minimum_quantity: 3, unit: "unit", cost_price: 5, selling_price: 10 } }));
    const item = created.ocs_stock.find(row => row.item_name === itemName); items.push(item);
    await json(await request.post(`${API}/inventory/items/${item.id}/ocs-actions`, { headers: oh, data: { action_type: "stock_in", quantity: 20, actual_batch_cost: 5, expiry_date: "2029-06-01", supplier_name: "Supply workspace supplier", received_date: new Date().toISOString().slice(0,10) } }));
  }
  let collection;
  for (let offset=1; offset<14; offset++) { const date=new Date(); date.setUTCDate(date.getUTCDate()+offset); if ([1,3,5,6].includes(date.getUTCDay())) { collection=date.toISOString().slice(0,10); break; } }
  async function create(note, lines = items.map(item => ({ inventory_id: item.id, quantity: 1 }))) {
    return (await json(await request.post(`${API}/restock-requests`, { headers: dh, data: { collection_date: collection, note: `${prefix}: ${note}`, items: lines } }))).request;
  }
  const pending = await create("waiting for acceptance");
  const accepted = await create("pack to prepare", [{ inventory_id: items[0].id, quantity: 3 }]);
  await json(await request.patch(`${API}/restock-requests/${accepted.id}`, { headers: oh, data: { status: "accepted" } }));
  async function complete() {
    const completed = await create("collected pack", [{ inventory_id: items[1].id, quantity: 2 }]);
    await json(await request.patch(`${API}/restock-requests/${completed.id}`, { headers: oh, data: { status: "accepted" } }));
    const pack = await json(await request.get(`${API}/restock-requests/${completed.id}/fulfilment`, { headers: oh }));
    await json(await request.patch(`${API}/restock-requests/${completed.id}/fulfilment`, { headers: oh, data: { lines: pack.fulfilment.items.map(line => ({ id: line.id, picked_quantity: line.reserved_quantity, fulfilled_quantity: line.reserved_quantity })) } }));
    await json(await request.patch(`${API}/restock-requests/${completed.id}`, { headers: oh, data: { status: "ready" } }));
    await json(await request.patch(`${API}/restock-requests/${completed.id}`, { headers: oh, data: { status: "completed" } }));
    return completed;
  }
  return { doctor, operator, oh, dh, items, pending, accepted, prefix, collection, complete };
}
async function open(page, actor, path, width=1440) {
  await page.addInitScript(token => localStorage.setItem("ocs_medecins_auth_token", token), actor.token);
  await page.setViewportSize({ width, height:900 }); await page.goto(`${STAFF}${path}`);
}

for (const width of [1280,1440,1920]) {
  test(`doctor supply requests use desktop space and preserve edit and cancellation at ${width}px`, async ({ page, request }) => {
    const fixture = await prepare(request); await open(page,fixture.doctor,"/supply-requests",width);
    const row=page.getByRole("article",{name:`Supply request ${fixture.pending.id}`,exact:true}); await expect(row).toBeVisible();
    expect((await row.boundingBox()).width).toBeGreaterThan(800); expect((await row.boundingBox()).height).toBeLessThan(200);
    expect((await row.boundingBox()).y).toBeLessThan(300); expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBeFalsy();
    await page.screenshot({path:`/tmp/ocs-supply-updated-doctor-${width}.png`});
    await page.getByLabel("Search supply requests").fill(`#${fixture.pending.id}`); await expect(page.getByRole("article")).toHaveCount(1);
    await row.getByRole("button",{name:"Edit request",exact:true}).click(); const modal=page.getByRole("dialog",{name:"Edit Supply Request",exact:true}); await expect(modal).toBeVisible();
    expect((await modal.boundingBox()).width).toBeLessThanOrEqual(1000);
    await modal.getByRole("button",{name:`Increase ${fixture.items[0].item_name}`,exact:true}).click();
    await modal.getByRole("button",{name:"Close",exact:true}).click(); await expect(page.getByRole("heading",{name:"Discard this request draft?",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Continue editing",exact:true}).click(); await modal.getByRole("button",{name:"Save changes",exact:true}).click(); await expect(modal).toBeHidden();
    const saved=await json(await request.get(`${API}/restock-requests/${fixture.pending.id}`,{headers:fixture.dh})); expect(saved.request.items.find(item=>item.inventory_id===fixture.items[0].id).quantity).toBe(2);
    await row.getByLabel(`More actions for request ${fixture.pending.id}`).click(); await row.getByRole("button",{name:"Cancel request",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Cancel this supply request?",exact:true})).toBeVisible();
    expect((await json(await request.get(`${API}/restock-requests/${fixture.pending.id}`,{headers:fixture.dh}))).request.status).toBe("pending");
    await page.getByRole("button",{name:"Archive request",exact:true}).click(); await expect(row).toBeHidden();
  });

  test(`operator queue shows identifiable previews and stable tabs at ${width}px`, async ({ page, request }) => {
    const fixture=await prepare(request); await open(page,fixture.operator,"/inventory?tab=queues&queue=new_requests",width);
    const row=page.getByRole("article",{name:`Supply request ${fixture.pending.id}`,exact:true}); await expect(row).toBeVisible();
    await expect(row).toContainText(`Request #${fixture.pending.id}`); await expect(row).toContainText(fixture.items[0].item_name); await expect(row).toContainText("+1 more");
    await expect(row.getByText("Accept and reserve",{exact:true})).toHaveCount(0);
    await page.evaluate(()=>document.fonts.ready);
    const tabs=[/^New requests/,/^Pick today/,/^Awaiting collection/,/^History/]; const before=[]; for(const name of tabs) before.push((await page.getByRole("button",{name}).boundingBox()).x);
    await page.screenshot({path:`/tmp/ocs-supply-updated-operator-${width}.png`});
    const search=page.getByLabel("Search current supply queue"); await search.fill(fixture.items[3].item_name); await expect(row).toBeVisible(); await expect(page.getByRole("article")).toHaveCount(1);
    await search.fill(`#${fixture.pending.id}`); await expect(row).toBeVisible();
    const response=page.waitForResponse(next=>next.url().includes(`/restock-requests/${fixture.pending.id}`)&&next.request().method()==="PATCH");
    await row.getByRole("button",{name:"Accept & reserve",exact:true}).click(); expect((await response).ok()).toBeTruthy(); await expect(row).toBeHidden();
    for(let i=0;i<tabs.length;i++) expect((await page.getByRole("button",{name:tabs[i]}).boundingBox()).x).toBeCloseTo(before[i],0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBeFalsy();
  });
}

test("doctor desktop creation supports keyboard selection and history stays compact and filtered",async({page,request})=>{
  const fixture=await prepare(request); const completed=await fixture.complete(); await open(page,fixture.doctor,"/supply-requests");
  await page.getByRole("button",{name:"New supply request",exact:true}).click(); const modal=page.getByRole("dialog",{name:"Request Supply from OCS",exact:true});
  const search=modal.getByLabel("Search OCS stock by name"); await search.fill("Abdominal tapping"); await expect(modal.getByText("No matching stock items. Try another name.")).toBeVisible();
  await search.fill(fixture.items[0].item_name); const option=modal.getByRole("button",{name:new RegExp(fixture.items[0].item_name)}); await option.focus(); await page.keyboard.press("Enter");
  await expect(modal.getByRole("button",{name:`Increase ${fixture.items[0].item_name}`,exact:true})).toBeVisible();
  await modal.getByLabel("Note (optional)").fill("Desktop keyboard request"); await page.screenshot({path:"/tmp/ocs-supply-updated-doctor-compose.png"});
  const created=page.waitForResponse(next=>next.url().endsWith("/restock-requests")&&next.request().method()==="POST"); await modal.getByRole("button",{name:"Submit request",exact:true}).click(); expect((await created).ok()).toBeTruthy(); await expect(modal).toBeHidden();
  await page.getByRole("button",{name:/^History/}).click(); await page.getByLabel("Search supply requests").fill(`#${completed.id}`);
  const row=page.getByRole("article",{name:`Supply request ${completed.id}`,exact:true}); await expect(row).toBeVisible(); await expect(page.getByRole("article")).toHaveCount(1);
  const insights=page.locator("details").filter({has:page.getByText("Most requested items",{exact:true})}); await expect(insights).not.toHaveAttribute("open","");
  expect((await row.boundingBox()).y).toBeLessThan((await insights.boundingBox()).y); await page.screenshot({path:"/tmp/ocs-supply-updated-doctor-history.png"});
  const download=page.waitForEvent("download"); await page.getByRole("button",{name:"Export CSV",exact:true}).click(); expect((await download).suggestedFilename()).toBe("my-supply-request-history.csv");
  await row.getByRole("button",{name:"View details",exact:true}).click(); await expect(page.getByRole("dialog",{name:`Request #${completed.id}`,exact:true})).toBeVisible();
  await page.getByRole("dialog",{name:`Request #${completed.id}`,exact:true}).getByRole("button",{name:"Close dialog",exact:true}).click();
  await page.setViewportSize({width:375,height:812}); await expect(page.getByText("Total",{exact:true})).toBeVisible(); await expect(page.getByLabel("Refresh supply requests")).toHaveCount(0);
});

test("operator preparation retries a failed load and preserves picking and collection",async({page,request})=>{
  const fixture=await prepare(request); await open(page,fixture.operator,"/inventory?tab=queues&queue=pick_today");
  let attempted=0; await page.route(`**/api/restock-requests/${fixture.accepted.id}/fulfilment`,async route=>{if(route.request().method()==="GET"&&attempted++===0)await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Pack unavailable. Please retry."})});else await route.continue();});
  await page.getByLabel("Search current supply queue").fill(`#${fixture.accepted.id}`); await page.getByRole("button",{name:"Open fulfilment",exact:true}).click();
  const modal=page.getByRole("dialog",{name:`Fulfil request #${fixture.accepted.id}`,exact:true}); await expect(modal.getByRole("alert")).toContainText("Pack unavailable"); await expect(modal.getByRole("button",{name:"Mark supply ready",exact:true})).toHaveCount(0);
  await modal.getByRole("button",{name:"Retry",exact:true}).click(); await expect(modal.getByText(fixture.items[0].item_name,{exact:true})).toBeVisible();
  await expect(modal.getByRole("columnheader",{name:"Requested",exact:true})).toBeVisible(); await expect(modal.getByRole("columnheader",{name:"Shortage",exact:true})).toBeVisible();
  expect((await modal.boundingBox()).width).toBeLessThanOrEqual(1100);
  await modal.getByLabel(`Picked quantity for ${fixture.items[0].item_name}`).fill("3"); await modal.getByLabel(`Fulfilled quantity for ${fixture.items[0].item_name}`).fill("3"); await page.screenshot({path:"/tmp/ocs-supply-updated-operator-prepare.png"});
  await modal.getByRole("button",{name:"Mark supply ready",exact:true}).click(); await expect(modal).toBeHidden();
  expect((await json(await request.get(`${API}/restock-requests/${fixture.accepted.id}`,{headers:fixture.oh}))).request.status).toBe("ready");
  await page.getByRole("button",{name:/^Awaiting collection/}).click(); await page.getByRole("button",{name:"Mark collected",exact:true}).click(); await expect(page.getByRole("heading",{name:"Mark supply collected",exact:true})).toBeVisible();
  await page.getByRole("dialog",{name:"Mark supply collected",exact:true}).getByRole("button",{name:"Mark collected",exact:true}).click();
  const result=await json(await request.get(`${API}/restock-requests/${fixture.accepted.id}`,{headers:fixture.oh})); expect(result.request.status).toBe("completed"); expect(result.request.transfer_transaction_id).toBeTruthy();
});

test("doctor history search ignores delayed results and refresh remains usable when switching views",async({page,request})=>{
  const fixture=await prepare(request); const completed=await fixture.complete(); await open(page,fixture.doctor,"/supply-requests");
  let release; const held=new Promise(resolve=>{ release=resolve; });
  await page.route("**/api/restock-requests?*",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("view")==="history"&&url.searchParams.get("request_id")===String(completed.id)) { const response=await route.fetch(); await held; await route.fulfill({response}); }
    else await route.continue();
  });
  try {
    await page.getByRole("button",{name:/^History/}).click();
    const oldRequest=page.waitForRequest(next=>new URL(next.url()).searchParams.get("request_id")===String(completed.id));
    await page.getByLabel("Search supply requests").fill(`#${completed.id}`); await oldRequest;
    await page.getByRole("button",{name:/^Active/}).click(); await expect(page.getByLabel("Refresh supply requests")).toBeEnabled();
    await page.getByLabel("Search supply requests").fill("#99999999"); await page.getByRole("button",{name:/^History/}).click();
    await expect(page.getByText("No requests match your filters.",{exact:true})).toBeVisible();
    const oldResponse=page.waitForResponse(next=>new URL(next.url()).searchParams.get("request_id")===String(completed.id)); release(); await (await oldResponse).json();
    await page.getByLabel("Search supply requests").press("Tab");
    await expect(page.getByText("No requests match your filters.",{exact:true})).toBeVisible(); await expect(page.getByRole("article")).toHaveCount(0);
  } finally { release(); }
});
