import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext } from "react";
import { useSelector } from "../../hooks";
import LoadingOverlay from "../../components/LoadingOverlay/LoadingOverlay";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";

const Item = () => {
  const { access } = useContext(GlobalInfoContext) || {};
  const { type, listId, isLoading, isSectionLoading } = useSelector(
    (state) => state.undoable.present.item,
  );
  const { mode } = usePresentationControllerMode();


  if (!type && (!isLoading || !listId)) {
    return <h2 className="text-2xl text-center mt-4 font-bold">{listId ? "Item Not Found" : "No Item Selected"}</h2>;
  }
  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        <SlideEditor access={access} presentationMode={mode} />
        <LoadingOverlay isLoading={Boolean(isSectionLoading && !isLoading)} className="flex-1 min-h-0">
          <ItemSlides />
        </LoadingOverlay>
      </div>
    </ErrorBoundary>
  );
};

export default Item;
