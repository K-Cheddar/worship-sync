import { useDispatch } from "../../hooks";
import {
  clearMonitor,
  clearProjector,
  clearStream,
  updateProjector,
} from "../../store/presentationSlice";
import { QuickLinkType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import Button from "../Button/Button";
import "./QuickLink.scss";

const QuickLink = ({ title, url, displayType, action }: QuickLinkType) => {
  const dispatch = useDispatch();

  const handleClick = () => {
    if (action === "clear") {
      if (displayType === "stream") dispatch(clearStream());
      if (displayType === "monitor") dispatch(clearMonitor());
      if (displayType === "projector") dispatch(clearProjector());
    } else if (url) {
      if (displayType === "projector")
        dispatch(
          updateProjector({
            type: "image",
            name: "",
            slide: {
              type: "Image",
              name: "Image",
              boxes: [
                {
                  id: generateRandomId(),
                  width: 100,
                  height: 100,
                  background: url,
                },
              ],
            },
          })
        );
    }
  };
  return (
    <li className="quick-link">
      <Button
        onClick={handleClick}
        variant="none"
        padding="p-0"
        className="w-full h-full flex-col"
      >
        {!url && <div className="quick-link-image bg-black" />}
        {url && <img className="quick-link-image" src={url} alt={title} />}
        <p className="text-center text-xs font-semibold whitespace-break-spaces w-full">
          {title}
        </p>
      </Button>
    </li>
  );
};

export default QuickLink;
