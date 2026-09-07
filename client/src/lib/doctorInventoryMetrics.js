export function itemOnHand(item) {
  return Number(item?.on_hand_quantity ?? item?.quantity ?? 0);
}

export function isAtOrBelowPar(item) {
  const par = Number(item?.minimum_quantity || 0);
  return par > 0 && itemOnHand(item) <= par;
}

export function isMissingExpiryItem(item) {
  return itemOnHand(item) > 0 && Boolean(item?.missing_expiry);
}

export function isNearExpiryItem(item) {
  return itemOnHand(item) > 0 && Boolean(item?.is_near_expiry);
}

export function isExpiredItem(item) {
  return Number(item?.expired_quantity || 0) > 0 || Boolean(item?.has_expired);
}

export function readDoctorMetrics(payload) {
  const metrics = payload?.doctor_metrics || {};
  return {
    at_or_below_par: Number(metrics.at_or_below_par || 0),
    missing_expiry: Number(metrics.missing_expiry || 0),
    near_expiry: Number(metrics.near_expiry || 0),
    expired: Number(metrics.expired || 0),
    ocs_can_fill: Number(metrics.ocs_can_fill || 0),
    item_ids: metrics.item_ids || {},
  };
}
