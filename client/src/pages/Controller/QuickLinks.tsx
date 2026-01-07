import QuickLinks from "../../containers/Preferences/QuickLinks";
import { useSelector } from "../../hooks";
import Spinner from "../../components/Spinner/Spinner";

const QuickLinksPage = () => {
  const { isLoading } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="flex flex-col gap-4 h-full w-full items-center justify-center">
        <p className="text-xl font-semibold">Loading quick links...</p>
        <Spinner />
      </div>
    );

  return (
    <div className="scrollbar-variable px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-semibold text-center mb-4">Quick Links</h2>
      <QuickLinks />
    </div>
  );
};

export default QuickLinksPage;
