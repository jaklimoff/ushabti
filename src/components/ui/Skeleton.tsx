import styles from "./ui.module.css";

/**
 * Every page is a dynamic server component that talks to Postgres before it
 * renders anything, so a slow query used to look like a click that did not
 * register. These stand in until the real thing arrives.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.skeleton}
      style={{
        display: "block",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: radius,
      }}
    />
  );
}
