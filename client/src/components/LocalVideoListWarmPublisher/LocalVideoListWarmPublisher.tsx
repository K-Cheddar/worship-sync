import { useEffect, useMemo } from "react";
import { useSelector } from "../../hooks";
import { useOutlineItemDocs } from "../../hooks/useOutlineItemDocs";
import { collectLocalVideoListWarmSourceIds } from "../../utils/collectLocalVideoListWarmSourceIds";
import { getNonHeadingOutlineItems } from "../../utils/outlineSlideSections";
import { publishLocalVideoWarmIntent } from "../../utils/localVideoWarmIntent";

/**
 * Publishes hardware video inputs present on the current service list — item
 * backgrounds and per-slide backgrounds on list items (plus the open item) —
 * so CaptureHost / CaptureManager can keep them warm before send.
 */
const LocalVideoListWarmPublisher = () => {
  const itemList = useSelector((state) => state.undoable.present.itemList.list);
  const openItem = useSelector((state) => state.undoable.present.item);
  const outlineItems = useMemo(
    () => getNonHeadingOutlineItems(itemList),
    [itemList],
  );
  const prefetchIds = useMemo(
    () => outlineItems.map((item) => item._id),
    [outlineItems],
  );
  const docsById = useOutlineItemDocs(prefetchIds);

  const sourceIds = useMemo(
    () =>
      collectLocalVideoListWarmSourceIds({
        itemList: outlineItems,
        openItem: openItem.isLoading ? null : openItem,
        docsById,
      }),
    [docsById, openItem, outlineItems],
  );
  const sourceKey = sourceIds.join("|");

  useEffect(() => {
    publishLocalVideoWarmIntent(sourceIds);
  }, [sourceIds, sourceKey]);

  useEffect(
    () => () => {
      publishLocalVideoWarmIntent([]);
    },
    [],
  );

  return null;
};

export default LocalVideoListWarmPublisher;
