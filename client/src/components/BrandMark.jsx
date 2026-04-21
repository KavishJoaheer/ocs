import { cx } from "../lib/utils.js";

function BrandMark({
  className,
  logoClassName,
  size = 60,
  maxWidth,
  withWordmark = true,
}) {
  const companyName = "OCS M\u00e9decins";
  const frameWidth = withWordmark ? maxWidth ?? Math.round(size * 4.35) : size;

  return (
    <span
      className={cx("inline-flex shrink-0 items-center", className)}
      style={{ height: size, width: frameWidth }}
    >
      <img
        alt={withWordmark ? `${companyName} Home Visit Doctors` : companyName}
        className={cx("block h-full w-full object-contain object-left", logoClassName)}
        src={withWordmark ? "/ocs-medecins-logo.png" : "/ocs-medecins-mark.png"}
      />
    </span>
  );
}

export default BrandMark;
