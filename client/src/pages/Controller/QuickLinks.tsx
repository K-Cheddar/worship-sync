import QuickLinks from "../../containers/Preferences/QuickLinks";
import { QuickLinksPageSkeleton } from "../../containers/Preferences/preferencesPageSkeletons";
import { useSelector } from "../../hooks";

type QuickLinksPageProps = {
  /** Overlay toolbar drawer: stream quick links only. */
  streamOnly?: boolean;
};

const QuickLinksPage = ({ streamOnly = false }: QuickLinksPageProps) => {
  const { isLoading } = useSelector(
    (state) => state.undoable.present.preferences
  );

  if (isLoading)
    return (
      <div className="scrollbar-variable flex h-full w-full flex-col items-center overflow-y-auto px-4 py-2">
        <h2 className="mb-4 text-center text-2xl font-semibold">Quick Links</h2>
        <QuickLinksPageSkeleton streamOnly={streamOnly} />
      </div>
    );

  return (
    <div className="scrollbar-variable px-4 py-2 overflow-y-auto">
      <h2 className="text-2xl font-semibold text-center mb-4">Quick Links</h2>
      <QuickLinks streamOnly={streamOnly} />
    </div>
  );
};

export default QuickLinksPage;
