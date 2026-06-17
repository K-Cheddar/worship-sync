import TeamsCrossSectionLink from "./TeamsCrossSectionLink";
import type { TeamsReturnTo } from "../teamsReturnNavigation";

type TeamEditorRelatedSectionProps = {
  title: string;
  summary: string;
  editLabel: string;
  editPath: string;
  returnTo: TeamsReturnTo;
};

const TeamEditorRelatedSection = ({
  title,
  summary,
  editLabel,
  editPath,
  returnTo,
}: TeamEditorRelatedSectionProps) => (
  <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold text-gray-200">{title}</p>
      <TeamsCrossSectionLink to={editPath} returnTo={returnTo}>
        {editLabel}
      </TeamsCrossSectionLink>
    </div>
    <p className="text-sm text-gray-300">{summary}</p>
  </div>
);

export default TeamEditorRelatedSection;
