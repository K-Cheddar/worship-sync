import {
  attachCloudCopyToLocalImageInItemList,
  updateLocalImageReferenceInItemList,
} from "../store/itemListSlice";
import { itemSlice } from "../store/itemSlice";
import {
  attachCloudCopyToLocalImageInPresentation,
  updateLocalImageReferenceInPresentation,
} from "../store/presentationSlice";
import type { AppDispatch } from "../store/store";
import type { LocalImageReferencePatch } from "./localImageAssets";

export const dispatchLocalImageCloudCopy = (
  dispatch: AppDispatch,
  payload: { itemId: string; assetId: string; mediaId: string; url: string },
) => {
  dispatch(itemSlice.actions.attachCloudCopyToLocalImageInActiveItem(payload));
  dispatch(attachCloudCopyToLocalImageInItemList(payload));
  dispatch(attachCloudCopyToLocalImageInPresentation(payload));
};

export const dispatchLocalImageReferencePatch = (
  dispatch: AppDispatch,
  payload: {
    itemId: string;
    assetId: string;
    patch: LocalImageReferencePatch;
  },
) => {
  dispatch(itemSlice.actions.updateLocalImageReferenceInActiveItem(payload));
  dispatch(updateLocalImageReferenceInItemList(payload));
  dispatch(updateLocalImageReferenceInPresentation(payload));
};

