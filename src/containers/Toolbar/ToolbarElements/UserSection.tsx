import {ReactComponent as AccountSVG} from "../../../assets/icons/account.svg";
import Button from "../../../components/Button/Button";

const UserSection = () => {
  return (
    <div>
      <Button color="orange" svg={AccountSVG} variant="tertiary" >Kevin</Button>
    </div>
  )
}

export default UserSection;