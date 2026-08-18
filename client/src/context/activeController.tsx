import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useDispatch, useSelector } from "../hooks";
import { selectControllerProfiles } from "../store/controllerProfilesSlice";
import { setOutlineScope } from "../store/itemListsSlice";
import { DEFAULT_OUTLINE_SCOPE } from "../utils/outlineScope";
import {
  ControllerProfile,
  PRESENTATION_CONTROLLER_ID,
  resolveControllerProfile,
} from "../utils/controllerProfiles";

/**
 * Which controller surface the tree below is being operated from.
 *
 * Send targeting resolves against this, so shared components — the slide grid,
 * the send-target toggles — behave correctly on whichever controller renders
 * them without every one of them having to be told which page it is on.
 *
 * The default is the presentation controller rather than "unknown" on purpose:
 * a surface with no controller context (a display window, a quick link fired
 * from the home page) has to resolve exactly as it did before profiles existed,
 * and the presentation profile ships unscoped.
 */
const ActiveControllerContext = createContext<string>(
  PRESENTATION_CONTROLLER_ID,
);

/**
 * Marks the tree below as belonging to one controller, and moves the outline
 * picker into that controller's scope.
 *
 * The scope switch lives here rather than in each page so it cannot be
 * forgotten: rendering a controller *is* what makes its outlines the ones in
 * play, and a page that declared its identity but not its scope would show one
 * controller's outlines while sending to another's displays.
 */
export const ActiveControllerProvider = ({
  profileId,
  children,
}: {
  profileId: string;
  children: ReactNode;
}) => {
  const dispatch = useDispatch();
  const profiles = useSelector(selectControllerProfiles);
  const outlineScope = useMemo(
    () => resolveControllerProfile(profiles, profileId).outlineScope,
    [profiles, profileId],
  );

  useEffect(() => {
    dispatch(setOutlineScope(outlineScope));
    // Hand the scope back on the way out. Surfaces that read the selected
    // outline without declaring a controller — the standalone credits editor,
    // for one — would otherwise inherit whichever controller was open last and
    // silently work against an auxiliary controller's outline.
    return () => {
      dispatch(setOutlineScope(DEFAULT_OUTLINE_SCOPE));
    };
  }, [dispatch, outlineScope]);

  return (
    <ActiveControllerContext.Provider value={profileId}>
      {children}
    </ActiveControllerContext.Provider>
  );
};

export const useActiveControllerId = () => useContext(ActiveControllerContext);

/**
 * The active controller's profile, resolved against the church registry.
 *
 * Falls back to the presentation profile when the registry has not synced or
 * the profile has been removed, so targeting always has something sound to
 * resolve against.
 */
export const useActiveControllerProfile = (): ControllerProfile => {
  const profileId = useActiveControllerId();
  const profiles = useSelector(selectControllerProfiles);
  return useMemo(
    () => resolveControllerProfile(profiles, profileId),
    [profiles, profileId],
  );
};

/**
 * The active controller's profile together with the whole registry.
 *
 * Targeting needs both: the profile says which displays this controller drives,
 * and the registry says which displays *other* controllers have claimed, which
 * is what lets an unscoped built-in yield a screen to the controller that owns
 * it.
 */
export const useControllerProfileRegistry = (): {
  profile: ControllerProfile;
  profiles: ControllerProfile[];
} => {
  const profileId = useActiveControllerId();
  const profiles = useSelector(selectControllerProfiles);
  return useMemo(
    () => ({
      profile: resolveControllerProfile(profiles, profileId),
      profiles,
    }),
    [profiles, profileId],
  );
};

/**
 * Route prefix for the active controller's own pages.
 *
 * Outline navigation (arrow keys, item links) builds paths from this. Auxiliary
 * controllers live under their own route, so a hardcoded "/controller" would
 * throw their operator onto the main controller mid-service.
 */
export const useControllerBasePath = (): string => {
  const profile = useActiveControllerProfile();
  return profile.type === "aux-presentation"
    ? `/aux-controller/${profile.id}`
    : "/controller";
};

export default ActiveControllerContext;
