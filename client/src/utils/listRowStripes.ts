/**
 * Alternating row backgrounds used on church admin panels and library search lists
 * (see `--color-admin-row-a` / `--color-admin-row-b` in globals.css).
 */
export const alternatingAdminListRowBg = (index: number) =>
  index % 2 === 0 ? "bg-admin-row-a" : "bg-admin-row-b";
