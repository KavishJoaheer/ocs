/** Dispatched when the signed-in doctor's bag inventory changes (restock, deduct, etc.). */
export const DOCTOR_BAG_INVENTORY_EVENT = "doctor-bag-inventory-updated";

export function notifyDoctorBagInventoryUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(DOCTOR_BAG_INVENTORY_EVENT));
}
