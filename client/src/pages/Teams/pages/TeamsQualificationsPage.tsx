import QualificationManager from "../managers/QualificationManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsQualificationsPage = () => {
  const { pageData, upsertData, removeData, refresh, canEditTeam } = useTeamsPage();

  return (
    <QualificationManager
      areas={pageData.qualificationAreas}
      levels={pageData.qualificationLevels}
      teams={pageData.teams}
      canEditTeam={canEditTeam}
      onAreaSaved={(area, replaceId) =>
        upsertData("qualificationAreas", "areaId", area, replaceId)
      }
      onLevelSaved={(level, replaceId) =>
        upsertData("qualificationLevels", "levelId", level, replaceId)
      }
      onArchived={() => void refresh()}
      onAreaRemoved={(areaId) =>
        removeData("qualificationAreas", "areaId", areaId)
      }
    />
  );
};

export default TeamsQualificationsPage;
