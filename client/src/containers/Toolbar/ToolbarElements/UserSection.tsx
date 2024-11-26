import { useContext } from "react";
import { ReactComponent as AccountSVG } from "../../../assets/icons/account.svg";
import Button from "../../../components/Button/Button";
import { GlobalInfoContext } from "../../../context/globalInfo";

const UserSection = () => {
  const { user } = useContext(GlobalInfoContext) || {};
  return (
    <div>
      <Button color="orange" svg={AccountSVG} variant="none">
        {user}
      </Button>
    </div>
  );
};

export default UserSection;
