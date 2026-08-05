import { useEffect, useMemo, useState } from "react";
import Button from "./Button/Button";
import Input from "./Input/Input";

export type ServicePlanRolePickerOption = {
  positionId: string;
  roleName?: string;
  label: string;
  teamId?: string;
  teamName?: string;
};

export const servicePlanRoleOptionName = (role: ServicePlanRolePickerOption): string =>
  role.roleName?.trim()
  || role.label.split(/\s+(?:\u00c2)?\u00b7\s+/).at(-1)?.trim()
  || "Unknown role";

export const servicePlanRoleOptionDisplayLabel = (
  role: ServicePlanRolePickerOption,
  options: ServicePlanRolePickerOption[],
): string => {
  const name = servicePlanRoleOptionName(role);
  const duplicates = options.filter(
    (option) => servicePlanRoleOptionName(option).toLocaleLowerCase() === name.toLocaleLowerCase(),
  ).length;
  return duplicates > 1 && role.teamName ? `${role.teamName} · ${name}` : name;
};

const groupServicePlanRoleOptionsByTeam = (options: ServicePlanRolePickerOption[]) => {
  const groups = new Map<string, { teamName: string; roles: ServicePlanRolePickerOption[] }>();
  options.forEach((role) => {
    const key = role.teamId || role.teamName || "other";
    const group = groups.get(key) || { teamName: role.teamName || "Other roles", roles: [] };
    group.roles.push(role);
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .sort((left, right) => left.teamName.localeCompare(right.teamName))
    .map((group) => ({
      ...group,
      roles: [...group.roles].sort((left, right) =>
        servicePlanRoleOptionName(left).localeCompare(servicePlanRoleOptionName(right)),
      ),
    }));
};

type ServicePlanRolePickerContentProps = {
  value: string;
  onValueChange: (positionId: string) => void;
  onSelectionComplete?: () => void;
  options: ServicePlanRolePickerOption[];
  teamFilterStorageKey: string;
  /** A parent team-notes filter already scopes the supplied options. */
  lockedTeamName?: string;
  allowEmpty?: boolean;
};

const readStoredTeamFilter = (key: string) => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeStoredTeamFilter = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage is optional; role selection remains available.
  }
};

/** Search and team-filter controls shared by popover and dropdown role pickers. */
const ServicePlanRolePickerContent = ({
  value,
  onValueChange,
  onSelectionComplete,
  options,
  teamFilterStorageKey,
  lockedTeamName,
  allowEmpty = true,
}: ServicePlanRolePickerContentProps) => {
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState(() => readStoredTeamFilter(teamFilterStorageKey));
  const teams = useMemo(() => {
    const byId = new Map<string, string>();
    options.forEach((role) => {
      if (role.teamId && role.teamName) byId.set(role.teamId, role.teamName);
    });
    return Array.from(byId, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [options]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRoles = useMemo(() => options.filter((role) => {
    if (!lockedTeamName && teamId && role.teamId !== teamId) return false;
    if (!normalizedQuery) return true;
    return `${servicePlanRoleOptionName(role)} ${role.teamName || ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  }), [lockedTeamName, normalizedQuery, options, teamId]);

  useEffect(() => {
    if (lockedTeamName || !teamId || teams.some((team) => team.id === teamId)) return;
    setTeamId("");
    writeStoredTeamFilter(teamFilterStorageKey, "");
  }, [lockedTeamName, teamFilterStorageKey, teamId, teams]);

  const chooseTeam = (nextTeamId: string) => {
    setTeamId(nextTeamId);
    writeStoredTeamFilter(teamFilterStorageKey, nextTeamId);
  };
  const selectRole = (positionId: string) => {
    onValueChange(positionId);
    onSelectionComplete?.();
  };

  return (
    <div className="w-72 space-y-2 p-1">
      <Input
        value={query}
        onChange={(next) => setQuery(String(next))}
        placeholder="Search roles"
        aria-label="Search roles"
        className="w-full"
        inputClassName="h-8 min-h-0 bg-gray-950 text-sm"
        onKeyDown={(event) => event.stopPropagation()}
      />
      {!lockedTeamName ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-gray-400">Filter by team</p>
          <div className="max-h-24 overflow-y-auto pr-0.5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by team">
              <Button
                variant={!teamId ? "cta" : "tertiary"}
                aria-pressed={!teamId}
                className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  chooseTeam("");
                }}
              >
                All teams
              </Button>
              {teams.map((team) => {
                const selected = team.id === teamId;
                return (
                  <Button
                    key={team.id}
                    variant={selected ? "cta" : "tertiary"}
                    aria-pressed={selected}
                    className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      chooseTeam(team.id);
                    }}
                  >
                    {team.name}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <div className="max-h-56 overflow-y-auto rounded border border-gray-700 p-1">
        {allowEmpty ? (
          <Button
            variant="tertiary"
            isSelected={!value}
            className="max-md:min-h-0 w-full px-2 py-1 text-left text-xs"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectRole("");
            }}
          >
            All roles
          </Button>
        ) : null}
        {groupServicePlanRoleOptionsByTeam(filteredRoles).map((group) => (
          <div key={group.teamName} className="py-0.5">
            <p className="px-2 py-1 text-[11px] font-medium text-gray-400">
              {group.teamName}
            </p>
            {group.roles.map((role) => (
              <Button
                key={role.positionId}
                variant="tertiary"
                isSelected={role.positionId === value}
                className="max-md:min-h-0 w-full px-2 py-1 text-left text-xs"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!lockedTeamName && role.teamId) chooseTeam(role.teamId);
                  selectRole(role.positionId);
                }}
              >
                <span className="block truncate">
                  {servicePlanRoleOptionDisplayLabel(role, options)}
                </span>
              </Button>
            ))}
          </div>
        ))}
        {filteredRoles.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-400">No matching roles.</p>
        ) : null}
      </div>
    </div>
  );
};

export default ServicePlanRolePickerContent;
