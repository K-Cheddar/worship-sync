import { useSelector } from "../../hooks";
import Button from "../../components/Button/Button";
import { X, Plus, Minus, SunMedium } from "lucide-react";
import { useDispatch } from "react-redux";
import {
  setDefaultSongBackgroundBrightness,
  setDefaultTimerBackgroundBrightness,
  setSelectedPreference,
  setDefaultBibleBackgroundBrightness,
  setDefaultFreeFormBackgroundBrightness,
  SelectedPreferenceType,
  setDefaultSlidesPerRowMobile,
  setDefaultSlidesPerRow,
  setDefaultSlidesPerRowMusic,
  setDefaultSlidesPerRowMusicMobile,
  setDefaultFormattedLyricsPerRow,
  setDefaultMediaItemsPerRow,
  setDefaultPreferences,
  setScrollbarWidth,
} from "../../store/preferencesSlice";
import cn from "classnames";
import Icon from "../../components/Icon/Icon";
import Input from "../../components/Input/Input";
import RadioButton from "../../components/RadioButton/RadioButton";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useContext } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { AccessType, GlobalInfoContext } from "../../context/globalInfo";

const Preferences = () => {
  const dispatch = useDispatch();
  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { access: currentAccess } = useContext(GlobalInfoContext) || {};

  const {
    preferences: {
      defaultSongBackground,
      defaultTimerBackground,
      defaultBibleBackground,
      defaultFreeFormBackground,
      defaultSongBackgroundBrightness,
      defaultTimerBackgroundBrightness,
      defaultBibleBackgroundBrightness,
      defaultFreeFormBackgroundBrightness,
      defaultSlidesPerRow,
      defaultSlidesPerRowMobile,
      defaultSlidesPerRowMusic,
      defaultSlidesPerRowMusicMobile,
      defaultFormattedLyricsPerRow,
      defaultMediaItemsPerRow,
      defaultShouldShowItemEditor,
      defaultIsMediaExpanded,
      defaultBibleFontMode,
      defaultFreeFormFontMode,
    },
    selectedPreference,
    scrollbarWidth,
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const backgroundPreferences = [
    {
      label: "Song Defaults",
      preference: "defaultSongBackground",
      background: defaultSongBackground,
      brightness: defaultSongBackgroundBrightness,
      setBrightness: setDefaultSongBackgroundBrightness,
    },
    {
      label: "Timer Defaults",
      preference: "defaultTimerBackground",
      background: defaultTimerBackground,
      brightness: defaultTimerBackgroundBrightness,
      setBrightness: setDefaultTimerBackgroundBrightness,
    },
    {
      label: "Bible Defaults",
      preference: "defaultBibleBackground",
      background: defaultBibleBackground,
      brightness: defaultBibleBackgroundBrightness,
      setBrightness: setDefaultBibleBackgroundBrightness,
    },
    {
      label: "Free Form Defaults",
      preference: "defaultFreeFormBackground",
      background: defaultFreeFormBackground,
      brightness: defaultFreeFormBackgroundBrightness,
      setBrightness: setDefaultFreeFormBackgroundBrightness,
    },
  ];

  const perRowPreferences = [
    {
      label: "Slides Per Row",
      value: defaultSlidesPerRow,
      setValue: setDefaultSlidesPerRow,
      max: 7,
      min: 1,
      access: ["full"],
    },
    {
      label: "Slides Per Row Mobile",
      value: defaultSlidesPerRowMobile,
      setValue: setDefaultSlidesPerRowMobile,
      max: 7,
      min: 1,
      access: ["full"],
    },
    {
      label: "Slides Per Row",
      value: defaultSlidesPerRowMusic,
      setValue: setDefaultSlidesPerRowMusic,
      max: 7,
      min: 1,
      access: ["music"],
    },
    {
      label: "Slides Per Row Mobile",
      value: defaultSlidesPerRowMusicMobile,
      setValue: setDefaultSlidesPerRowMusicMobile,
      max: 7,
      min: 1,
      access: ["music"],
    },
    {
      label: "Formatted Lyrics Per Row",
      value: defaultFormattedLyricsPerRow,
      setValue: setDefaultFormattedLyricsPerRow,
      max: 4,
      min: 1,
      access: ["full"],
    },
    {
      label: "Media Items Per Row",
      value: defaultMediaItemsPerRow,
      setValue: setDefaultMediaItemsPerRow,
      max: 7,
      min: 2,
      access: ["full"],
    },
  ];

  const visibilityPreferences = [
    {
      label: "Show Item Editor",
      value: defaultShouldShowItemEditor,
      property: "defaultShouldShowItemEditor",
    },
    {
      label: "Is Media Expanded",
      value: defaultIsMediaExpanded,
      property: "defaultIsMediaExpanded",
    },
  ];

  const itemPreferences = [
    {
      label: "Bible Overflow Mode",
      value: defaultBibleFontMode,
      property: "defaultBibleFontMode",
      options: ["fit", "separate", "multiple"],
    },
    {
      label: "Free Form Overflow Mode",
      value: defaultFreeFormFontMode,
      property: "defaultFreeFormFontMode",
      options: ["fit", "separate"],
    },
  ];

  return (
    <ErrorBoundary>
      {currentAccess === "full" && (
        <ul className="flex flex-wrap gap-6 justify-center">
          {backgroundPreferences.map(
            ({ label, preference, background, brightness, setBrightness }) => (
              <li
                key={preference}
                className={cn("flex flex-col gap-2 p-2 w-fit")}
              >
                <p className="font-semibold text-center border-b-2 border-gray-400 pb-2 text-lg">
                  {label}
                </p>
                <section className="flex gap-2 items-center flex-wrap">
                  <p className="font-semibold">Background:</p>
                  <Button
                    variant="none"
                    padding="p-0"
                    className={cn(
                      "w-fit lg:min-w-[14vw] max-lg:min-w-[35vw] aspect-video self-center border-4 flex gap-2 items-center justify-center",
                      selectedPreference === preference
                        ? "border-cyan-400"
                        : "border-gray-500 hover:border-gray-300"
                    )}
                    onClick={() => {
                      dispatch(
                        setSelectedPreference(
                          preference as SelectedPreferenceType
                        )
                      );
                    }}
                  >
                    {background ? (
                      <DisplayWindow
                        width={isMobile ? 35 : 14}
                        displayType="projector"
                        shouldPlayVideo
                        boxes={[
                          {
                            background: background.background,
                            id: `${preference}-display-window`,
                            width: 100,
                            height: 100,
                            brightness,
                            mediaInfo: background.mediaInfo,
                          },
                        ]}
                      />
                    ) : (
                      <p>None</p>
                    )}
                  </Button>
                  <Button
                    variant="primary"
                    svg={X}
                    onClick={() => {
                      dispatch(setDefaultPreferences({ [preference]: "" }));
                    }}
                  ></Button>
                </section>
                <section className="flex gap-2 items-center">
                  <p className="font-semibold">Background Brightness:</p>
                  <Icon size="xl" svg={SunMedium} color="#fbbf24" />
                  <Button
                    svg={Minus}
                    variant="tertiary"
                    onClick={() => dispatch(setBrightness(brightness - 10))}
                  />
                  <Input
                    label="Brightness"
                    type="number"
                    value={brightness}
                    onChange={(val) => dispatch(setBrightness(val as number))}
                    inputTextSize="text-xs"
                    hideLabel
                    data-ignore-undo="true"
                    max={100}
                    min={1}
                  />
                  <Button
                    svg={Plus}
                    variant="tertiary"
                    onClick={() => dispatch(setBrightness(brightness + 10))}
                  />
                </section>
              </li>
            )
          )}
        </ul>
      )}
      <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
        Default Items Per Row
      </h2>
      <ul className="flex flex-col gap-6 items-center">
        {perRowPreferences
          .filter(
            ({ access }) =>
              access && access.includes(currentAccess as AccessType)
          )
          .map(({ label, value, setValue, max, min }) => (
            <li
              key={label}
              className={cn("grid grid-cols-2 gap-2 items-center p-2")}
            >
              <p className="font-semibold">{label}:</p>
              <section className="flex gap-2 items-center">
                <Button
                  svg={Minus}
                  variant="tertiary"
                  onClick={() => dispatch(setValue(value - 1))}
                />
                <Input
                  label={label}
                  type="number"
                  value={value}
                  onChange={(val) => dispatch(setValue(val as number))}
                  inputTextSize="text-xs"
                  hideLabel
                  data-ignore-undo="true"
                  max={max}
                  min={min}
                />
                <Button
                  svg={Plus}
                  variant="tertiary"
                  onClick={() => dispatch(setValue(value + 1))}
                />
              </section>
            </li>
          ))}
      </ul>
      {currentAccess === "full" && (
        <>
          <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
            Default Visibility
          </h2>
          <ul className="flex flex-col gap-6 items-center">
            {visibilityPreferences.map(({ label, value, property }) => (
              <li
                key={label}
                className={cn("grid grid-cols-2 gap-2 items-center p-2")}
              >
                <p className="font-semibold text-right">{label}:</p>
                <section className="flex gap-2 items-center px-2">
                  <RadioButton
                    label="Shown"
                    value={value}
                    onChange={() =>
                      dispatch(setDefaultPreferences({ [property]: true }))
                    }
                  />
                  <RadioButton
                    label="Hidden"
                    value={!value}
                    onChange={() =>
                      dispatch(setDefaultPreferences({ [property]: false }))
                    }
                  />
                </section>
              </li>
            ))}
          </ul>
          <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
            Item Preferences
          </h2>
          <ul className="flex flex-col gap-6 items-center">
            {itemPreferences.map(({ label, value, property, options }) => (
              <li
                key={label}
                className={cn(
                  "grid grid-cols-2 gap-2 items-center p-2 justify-center"
                )}
              >
                <p className="font-semibold text-right">{label}:</p>
                <section className="flex gap-2 items-center px-2">
                  {options.map((option) => (
                    <RadioButton
                      key={option}
                      label={option}
                      labelClassName="capitalize"
                      value={value === option}
                      onChange={() =>
                        dispatch(setDefaultPreferences({ [property]: option }))
                      }
                    />
                  ))}
                </section>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
        Scrollbar Width
      </h2>
      <ul className="flex gap-6 items-center justify-center">
        <li>
          <RadioButton
            label="Thin"
            value={scrollbarWidth === "thin"}
            onChange={() => dispatch(setScrollbarWidth("thin"))}
          />
        </li>
        <li>
          <RadioButton
            label="Auto"
            value={scrollbarWidth === "auto"}
            onChange={() => dispatch(setScrollbarWidth("auto"))}
          />
        </li>
        <li>
          <RadioButton
            label="None"
            value={scrollbarWidth === "none"}
            onChange={() => dispatch(setScrollbarWidth("none"))}
          />
        </li>
      </ul>
    </ErrorBoundary>
  );
};

export default Preferences;
