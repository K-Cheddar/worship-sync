import { useParams } from "react-router-dom";
import BoardPresentationScreen from "../boards/BoardPresentationScreen";

const BoardPresent = () => {
  const { aliasId = "" } = useParams();
  return <BoardPresentationScreen aliasId={aliasId} />;
};

export default BoardPresent;
