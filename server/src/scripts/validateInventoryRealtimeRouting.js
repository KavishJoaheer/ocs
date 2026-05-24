const { shouldDeliverInventoryEvent } = require("../lib/inventoryRealtime");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runInventoryRealtimeValidation() {
  const doctorClient = { role: "doctor", doctorId: 12, userId: 44 };
  const operatorClient = { role: "operator", doctorId: null, userId: 7 };

  assert(
    shouldDeliverInventoryEvent(doctorClient, {
      stockScope: "doctor",
      ownerDoctorId: 12,
    }),
    "doctor should receive own bag updates",
  );

  assert(
    !shouldDeliverInventoryEvent(doctorClient, {
      stockScope: "doctor",
      ownerDoctorId: 99,
    }),
    "doctor must not receive other doctor bag updates",
  );

  assert(
    shouldDeliverInventoryEvent(doctorClient, {
      stockScope: "ocs",
      ownerDoctorId: null,
    }),
    "doctor should receive master stock updates for restock views",
  );

  assert(
    shouldDeliverInventoryEvent(operatorClient, {
      stockScope: "doctor",
      ownerDoctorId: 12,
    }),
    "operator should receive doctor bag updates",
  );

  console.log("[inventory-realtime] routing validation passed");
}

runInventoryRealtimeValidation();
