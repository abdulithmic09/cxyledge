import { createContext, useContext } from "react";
import { normalizeRole, type Role } from "@/lib/inventory/api";

export const RoleContext = createContext<Role>("viewer");

/** What the signed-in person may do in the active book. The server checks the same rules. */
export function useRole() {
  const role = normalizeRole(useContext(RoleContext));
  return { role, canEdit: role !== "viewer", isOwner: role === "owner" };
}

export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including deleting, restoring, backups and managing people.",
  staff: "Add and edit entries, bills, payments and files. Can't delete.",
  viewer: "Sees everything and can export reports. Can't change anything.",
};
