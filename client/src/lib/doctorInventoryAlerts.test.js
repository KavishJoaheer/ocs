import assert from "node:assert/strict";
import test from "node:test";
import { doctorBagReadiness } from "./doctorInventoryAlerts.js";

test("empty and unusable bags are not described as ready", () => {
  for (const items of [[], [{quantity:0,minimum_quantity:0}], [{quantity:5,available_to_use:0,expired_quantity:5,minimum_quantity:2}]]) {
    assert.deepEqual(doctorBagReadiness(items), {label:"No usable bag stock",attention:true});
  }
});
test("stocked bags distinguish missing levels from sufficient supplies", () => {
  assert.equal(doctorBagReadiness([{quantity:10,minimum_quantity:0}]).label,"Minimum levels not set");
  assert.equal(doctorBagReadiness([{quantity:10,minimum_quantity:2},{quantity:2,minimum_quantity:0}]).label,"Some minimum levels missing");
  assert.deepEqual(doctorBagReadiness([{quantity:10,minimum_quantity:2},{quantity:0,minimum_quantity:0}]),{label:"Stock sufficient",attention:false});
});
test("low, depleted and expiry issues keep a stocked bag in attention", () => {
  assert.equal(doctorBagReadiness([{quantity:2,minimum_quantity:2}]).label,"1 item low");
  assert.equal(doctorBagReadiness([{quantity:0,minimum_quantity:2,ever_stocked:true},{quantity:10,minimum_quantity:2}]).label,"1 item out of stock");
  assert.deepEqual(doctorBagReadiness([{quantity:10,minimum_quantity:2,is_near_expiry:true}]),{label:"Stock needs attention",attention:true});
});
test("billing services do not count as usable bag stock", () => {
  assert.equal(doctorBagReadiness([{item_type:"Service",quantity:20,minimum_quantity:2}]).label,"No usable bag stock");
});
