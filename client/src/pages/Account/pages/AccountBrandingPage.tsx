import { BrandingForm } from "../../Controller/AccountFormSections";
import { useAccountPage } from "../AccountPageContext";
import { AccountBrandingPageSkeleton } from "../accountPageSkeletons";

const AccountBrandingPage = () => {
  const { churchId, context } = useAccountPage();

  if (context?.churchBrandingStatus === "loading") {
    return <AccountBrandingPageSkeleton />;
  }

  return (
    <BrandingForm
      churchId={churchId}
      branding={
        context?.churchBranding || {
          mission: "",
          vision: "",
          logos: { square: null, wide: null },
          colors: [],
        }
      }
      brandingStatus={context?.churchBrandingStatus || "loading"}
    />
  );
};

export default AccountBrandingPage;
