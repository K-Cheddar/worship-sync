import PositionManager from "../managers/PositionManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsPositionsPage = () => {
  const { pageData, upsertData, removeData, reorderPositions, refresh, canEditTeams } =
    useTeamsPage();

  return (
    <PositionManager
      positions={pageData.positions}
      teams={pageData.teams}
      data={pageData}
      canEdit={canEditTeams}
      onSaved={(position, replaceId) =>
        upsertData("positions", "positionId", position, replaceId)
      }
      onArchived={() => void refresh()}
      onRemoved={(positionId) =>
        removeData("positions", "positionId", positionId)
      }
      onReordered={(teamId, orderedPositionIds) =>
        void reorderPositions(teamId, orderedPositionIds)
      }
    />
  );
};

export default TeamsPositionsPage;
