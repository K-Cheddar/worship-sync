import IntakeManager from "../managers/IntakeManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsFormsPage = () => {
  const { pageData, upsertData, canEditTeams } = useTeamsPage();

  return (
    <IntakeManager
      forms={pageData.intakeForms}
      submissions={pageData.intakeSubmissions}
      services={pageData.services}
      members={pageData.members}
      teams={pageData.teams}
      canEdit={canEditTeams}
      onFormSaved={(form) => upsertData("intakeForms", "formId", form)}
      onSubmissionSaved={(submission) =>
        upsertData("intakeSubmissions", "submissionId", submission)
      }
      onMemberSaved={(member) => upsertData("members", "memberId", member)}
    />
  );
};

export default TeamsFormsPage;
