import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useStore } from "react-redux";
import { Copy, Plus, Trash2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  addControllerProfile,
  removeControllerProfile,
  renameControllerProfile,
  selectControllerProfiles,
  setControllerProfileDefaultSends,
  setControllerProfileEnabled,
  setControllerProfileOutputs,
} from "../../store/controllerProfilesSlice";
import { RootState } from "../../store/store";
import {
  ControllerProfile,
  getControllerOutputs,
  getControllersClaimingOutput,
  isBuiltInControllerId,
  toggleControllerOutput,
} from "../../utils/controllerProfiles";
import { writeControllerProfiles } from "../../utils/controllerProfilesWriter";
import { isPushOutputType } from "../../utils/displayOutputs";
import { buildShareableHashRouterUrl } from "../../utils/environment";

const SAVE_ERROR =
  "Couldn't save that controller. Check your connection and try again.";

const getControllerPath = (profile: ControllerProfile) =>
  `/aux-controller/${profile.id}`;

/**
 * Controllers tab: which operator surfaces exist, which displays each one
 * drives, and where its new items land.
 *
 * The built-in controllers are listed but not editable here. They ship
 * unrestricted so a church that never opens this page keeps behaving exactly as
 * it did, and narrowing the presentation controller from a settings page is a
 * much bigger decision than it looks — it would stop existing items reaching
 * displays they already reach.
 */
const ControllerProfilesPanel = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { showToast } = useToast();
  const { firebaseDb, churchId } = useContext(GlobalInfoContext) || {};

  const profiles = useSelector(selectControllerProfiles);
  const outputs = useSelector(selectDisplayOutputs);
  const isLoaded = useSelector(
    (state: RootState) => state.controllerProfiles?.isLoaded ?? false,
  );

  const [pendingName, setPendingName] = useState<Record<string, string>>({});
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());

  /** Displays a controller can actually be given. */
  const pushOutputs = useMemo(
    () => outputs.filter((o) => o.enabled && isPushOutputType(o.type)),
    [outputs],
  );

  /**
   * Every push display including retired ones.
   *
   * Retired displays are listed rather than filtered out, because a display an
   * operator just created and cannot find here reads as a broken page. They are
   * shown switched off with the reason, so the fix — enable it above — is
   * obvious instead of being guessed at.
   */
  const assignableOutputs = useMemo(
    () => outputs.filter((o) => isPushOutputType(o.type)),
    [outputs],
  );

  /**
   * Persist whatever the store holds after a dispatch.
   *
   * Reading back from the store rather than recomputing keeps this honest when
   * a reducer declines an edit — the panel then saves what actually happened.
   */
  const persist = useCallback(
    (previous: ControllerProfile[]) => {
      const next = selectControllerProfiles(store.getState());
      const result = persistenceQueue.current
        .catch(() => undefined)
        .then(() =>
          writeControllerProfiles(firebaseDb, churchId, next, previous),
        );
      persistenceQueue.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result.then((saved) => {
        if (!saved) showToast(SAVE_ERROR, "error");
        return saved;
      });
    },
    [churchId, firebaseDb, showToast, store],
  );

  const withPersist = useCallback(
    (action: Parameters<typeof dispatch>[0]) => {
      const previous = selectControllerProfiles(store.getState());
      dispatch(action);
      void persist(previous);
    },
    [dispatch, persist, store],
  );

  const auxProfiles = profiles.filter((p) => p.type === "aux-presentation");
  /**
   * Built-ins are configured here like any other controller, but they are
   * product surfaces with fixed routes: they can be named and given displays,
   * never removed or switched off. Retiring the presentation controller would
   * strand every operator in the church.
   */
  const isFixedSurface = (profile: ControllerProfile) =>
    isBuiltInControllerId(profile.id);

  const addController = () => {
    // Seed with nothing selected rather than guessing a display: pointing a new
    // controller at a screen that is already live is not a default anyone wants
    // applied silently.
    withPersist(addControllerProfile({ name: "New Controller" }));
  };

  const renderProfile = (profile: ControllerProfile) => {
    const fixed = isFixedSurface(profile);
    // Ticked state comes from what the controller actually drives, not its
    // stored list. On a never-configured built-in those differ: the list is
    // empty while it really drives every screen.
    const drivenIds = new Set(
      getControllerOutputs(profile, pushOutputs).map((o) => o.id),
    );
    const assignedIds = new Set(profile.outputIds);
    const defaults = new Set(profile.defaultSendOutputIds);
    const controllerUrl = buildShareableHashRouterUrl(
      getControllerPath(profile),
    );
    // Any display can go to any controller, so every one is on offer.
    const assignableForProfile = assignableOutputs;
    return (
      <li
        key={profile.id}
        className="flex flex-col gap-3 rounded-md border border-gray-600 bg-gray-800 p-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            label="Name"
            className="min-w-52 flex-1"
            value={pendingName[profile.id] ?? profile.name}
            onChange={(value) =>
              setPendingName((prev) => ({
                ...prev,
                [profile.id]: String(value),
              }))
            }
            onBlur={() => {
              const next = pendingName[profile.id];
              setPendingName((prev) => {
                const { [profile.id]: _dropped, ...rest } = prev;
                return rest;
              });
              if (next === undefined || next === profile.name) return;
              withPersist(
                renameControllerProfile({
                  id: profile.id,
                  name: next,
                }),
              );
            }}
          />
          <Toggle
            label="Enabled"
            value={profile.enabled}
            onChange={(value) =>
              withPersist(
                setControllerProfileEnabled({
                  id: profile.id,
                  enabled: value,
                }),
              )
            }
          />
          {!fixed && (
          <Button
            svg={Copy}
            variant="tertiary"
            className="text-sm"
            onClick={() => {
              navigator.clipboard
                ?.writeText(controllerUrl)
                .then(() => showToast("Controller link copied", "success"))
                .catch(() =>
                  showToast("Couldn't copy that link", "error"),
                );
            }}
          >
            Copy link
          </Button>
          )}
          {!fixed && (
            <Button
              svg={Trash2}
              variant="secondary"
              className="text-sm"
              onClick={() =>
                withPersist(removeControllerProfile(profile.id))
              }
            >
              Remove
            </Button>
          )}
        </div>

        {/* aria-label carries the controller name so each card's group is
            distinguishable when several are listed; the legend stays short. */}
        <fieldset
          className="flex flex-col gap-2 border-0 p-0"
          aria-label={`${profile.name} — displays it drives`}
        >
          <legend className="text-sm font-semibold">
            Displays it drives
          </legend>
          {assignableForProfile.length === 0 ? (
            <p className="text-xs text-gray-400">
              No displays configured yet. Add one under Displays above.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {assignableForProfile.map((output) => {
                const claimedBy = getControllersClaimingOutput(
                  profiles,
                  output.id,
                  profile.id,
                );
                return (
                  <div key={output.id} className="flex flex-col">
                    <Toggle
                      label={output.name}
                      disabled={!output.enabled}
                      value={
                        output.enabled
                          ? drivenIds.has(output.id)
                          : assignedIds.has(output.id)
                      }
                      onChange={(value) =>
                        withPersist(
                          setControllerProfileOutputs({
                            id: profile.id,
                            outputIds: toggleControllerOutput(
                              profile,
                              pushOutputs,
                              output.id,
                              value,
                            ),
                          }),
                        )
                      }
                    />
                    {!output.enabled && (
                      <span className="pl-1 text-xs text-gray-400">
                        Turned off &mdash; enable it under Displays
                        above
                      </span>
                    )}
                    {/* Sharing a screen between controllers is legal but
                        never accidental: both operators can then send to
                        it and the last send wins. */}
                    {output.enabled && claimedBy.length > 0 && (
                      <span className="pl-1 text-xs text-amber-300">
                        Also driven by{" "}
                        {claimedBy.map((p) => p.name).join(", ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {drivenIds.size === 0 && (
            <p className="text-xs text-amber-300">
              This controller drives no displays and cannot send anything.
              Pick at least one.
            </p>
          )}
        </fieldset>

        <fieldset
          className="flex flex-col gap-2 border-0 p-0"
          aria-label={`${profile.name} — default displays for new items`}
        >
          <legend className="text-sm font-semibold">
            Default displays for new items
          </legend>
          <p className="text-xs text-gray-400">
            Where items added on this controller go. Leave all off to use
            every display it drives.
          </p>
          {getControllerOutputs(profile, pushOutputs).length === 0 && (
            <p className="text-xs text-gray-400">
              Nothing to choose from until this controller drives at
              least one display that is turned on.
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {getControllerOutputs(profile, pushOutputs).map((output) => (
              <Toggle
                key={output.id}
                label={output.name}
                value={defaults.has(output.id)}
                onChange={(value) => {
                  const nextIds = value
                    ? [...profile.defaultSendOutputIds, output.id]
                    : profile.defaultSendOutputIds.filter(
                        (id) => id !== output.id,
                      );
                  withPersist(
                    setControllerProfileDefaultSends({
                      id: profile.id,
                      outputIds: nextIds,
                    }),
                  );
                }}
              />
            ))}
          </div>
        </fieldset>
      </li>
    );
  };

  return (
    <section className="flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-gray-300">
          A controller is an operator surface with its own outlines and its own
          screens. Items added on a controller stay on its screens, so a second
          audience display can run completely different content.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Built-in</h3>
        <ul className="flex flex-col gap-4">
          {profiles.filter(isFixedSurface).map(renderProfile)}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Additional controllers</h3>
          <Button
            svg={Plus}
            variant="primary"
            className="text-sm"
            disabled={!isLoaded}
            onClick={addController}
          >
            Add controller
          </Button>
        </div>

        {auxProfiles.length === 0 && (
          <p className="rounded-md border border-dashed border-gray-600 px-3 py-6 text-center text-sm text-gray-400">
            No additional controllers yet. Add one to drive a second
            audience-facing screen with its own content.
          </p>
        )}

        <ul className="flex flex-col gap-4">
          {auxProfiles.map(renderProfile)}
        </ul>
      </div>
    </section>
  );
};

export default ControllerProfilesPanel;
