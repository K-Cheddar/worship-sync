import type { MemberPermissions, ServicesPermission } from "../../api/authTypes";

export const serviceEditingAccessOptions: {
  value: ServicesPermission;
  label: string;
}[] = [
  { value: "none", label: "No service editing" },
  { value: "edit", label: "Edit services and plans" },
];

export const toServicesAccessOption = (
  permissions?: MemberPermissions,
  role?: string,
): ServicesPermission => (role === "admin" ? "edit" : permissions?.services || "none");

/** Teams edit is intentionally a superset of Services edit for legacy editors. */
export const formatMemberServicesAccessSummary = (
  permissions?: MemberPermissions,
  role?: string,
) =>
  role === "admin" ||
  permissions?.teams === "edit" ||
  permissions?.services === "edit"
    ? "Edit services and plans"
    : "No service editing";
