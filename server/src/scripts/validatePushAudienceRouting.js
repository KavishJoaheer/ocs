const {
  resolveLowStockAlertDestinations,
  validateLowStockAlertDestinations,
} = require("../lib/push");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runAudienceRoutingValidation() {
  const doctorBagAlert = {
    source: "doctor_bag",
    doctorId: 12,
    doctorUserId: 34,
    itemId: 99,
  };

  const doctorBagDestinations = resolveLowStockAlertDestinations(doctorBagAlert);
  assert(doctorBagDestinations.length === 2, "doctor_bag should target doctor user + operator role");
  assert(
    doctorBagDestinations.some(
      (destination) => destination.type === "user" && destination.userId === 34 && destination.audience === "doctor",
    ),
    "doctor_bag must include the active doctor user target",
  );
  assert(
    doctorBagDestinations.some(
      (destination) => destination.type === "role" && destination.role === "operator",
    ),
    "doctor_bag must include operator role target",
  );
  assert(
    !doctorBagDestinations.some((destination) => destination.role === "doctor"),
    "doctor_bag must not broadcast to doctor role group",
  );
  assert(
    validateLowStockAlertDestinations(doctorBagAlert, doctorBagDestinations).ok,
    "doctor_bag destination mapping should validate",
  );

  const warehouseAlert = {
    source: "master_warehouse",
    itemId: 501,
  };

  const warehouseDestinations = resolveLowStockAlertDestinations(warehouseAlert);
  assert(warehouseDestinations.length === 2, "master_warehouse should target operator + admin");
  assert(
    warehouseDestinations.every((destination) => ["operator", "admin"].includes(destination.role)),
    "master_warehouse must only include operator/admin roles",
  );
  assert(
    !warehouseDestinations.some((destination) => destination.role === "doctor"),
    "master_warehouse must exclude doctor role",
  );
  assert(
    validateLowStockAlertDestinations(warehouseAlert, warehouseDestinations).ok,
    "master_warehouse destination mapping should validate",
  );

  const invalidWarehouseDestinations = [
    { type: "role", role: "doctor", audience: "doctor" },
  ];
  assert(
    !validateLowStockAlertDestinations(warehouseAlert, invalidWarehouseDestinations).ok,
    "master_warehouse must reject doctor audience mappings",
  );

  console.log("[push-audience] routing validation passed");
}

runAudienceRoutingValidation();
