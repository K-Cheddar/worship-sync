import { Link } from "react-router-dom";
import type { PersonalScheduleAccess } from "./myScheduleOperations";

const VolunteerSelfServiceNavigation = ({
  access,
  active,
}: {
  access?: PersonalScheduleAccess;
  active: "schedule" | "availability";
}) => {
  const links = access
    ? [
        { id: "schedule" as const, label: "My Schedule", to: "/s?view=schedule" },
        { id: "availability" as const, label: "My Availability", to: "/s?view=availability" },
      ]
    : [
        { id: "schedule" as const, label: "My Schedule", to: "/my-schedule" },
        { id: "availability" as const, label: "My Availability", to: "/my-availability" },
      ];

  return (
    <nav aria-label="Volunteer pages" className="flex w-full gap-2 border-b border-gray-800 pb-3">
      {links.map((link) => (
        <Link
          key={link.id}
          to={link.to}
          aria-current={active === link.id ? "page" : undefined}
          className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${
            active === link.id
              ? "bg-teal-900/50 text-teal-100"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
};

export default VolunteerSelfServiceNavigation;
