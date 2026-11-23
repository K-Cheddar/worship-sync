import MySchedule from "./MySchedule";
import type { PersonalScheduleAccess } from "./myScheduleOperations";

/** Backward-compatible page entry point; availability now lives in My Schedule. */
const MyAvailability = ({ access, navigationGuardProvided = false }: {
  access?: PersonalScheduleAccess;
  navigationGuardProvided?: boolean;
}) => (
  <MySchedule access={access} navigationGuardProvided={navigationGuardProvided} />
);

export default MyAvailability;
