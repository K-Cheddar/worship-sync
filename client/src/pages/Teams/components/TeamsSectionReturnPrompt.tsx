import TeamsCrossSectionLink from "./TeamsCrossSectionLink";
import {
  buildSectionReturnTo,
  TEAMS_SECTION_PATHS,
  type TeamsSectionPath,
} from "../teamsReturnNavigation";

type TeamsSectionReturnPromptProps = {
  message: string;
  actionLabel?: string;
  originSection: TeamsSectionPath;
};

/** Guides operators to create a team, then return to the section they came from. */
const TeamsSectionReturnPrompt = ({
  message,
  actionLabel = "Create a team",
  originSection,
}: TeamsSectionReturnPromptProps) => (
  <p className="text-sm text-gray-300">
    {message}{" "}
    <TeamsCrossSectionLink
      to={TEAMS_SECTION_PATHS.groups}
      returnTo={buildSectionReturnTo(originSection)}
    >
      {actionLabel}
    </TeamsCrossSectionLink>
    .
  </p>
);

export default TeamsSectionReturnPrompt;
