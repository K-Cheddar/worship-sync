import { useSelector } from "../../hooks";
import Button from "../../components/Button/Button";
import { ReactComponent as RemoveSVG } from "../../assets/icons/remove.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../assets/icons/remove.svg";
import { ReactComponent as BrightnessSVG } from "../../assets/icons/brightness.svg";
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

const Preferences = () => {
  const dispatch = useDispatch();

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
      defaultFormattedLyricsPerRow,
      defaultMediaItemsPerRow,
      defaultShouldShowItemEditor,
      defaultIsMediaExpanded,
      defaultBibleFontMode,
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
    },
    {
      label: "Slides Per Row Mobile",
      value: defaultSlidesPerRowMobile,
      setValue: setDefaultSlidesPerRowMobile,
      max: 7,
      min: 1,
    },
    {
      label: "Formatted Lyrics Per Row",
      value: defaultFormattedLyricsPerRow,
      setValue: setDefaultFormattedLyricsPerRow,
      max: 4,
      min: 1,
    },
    {
      label: "Media Items Per Row",
      value: defaultMediaItemsPerRow,
      setValue: setDefaultMediaItemsPerRow,
      max: 7,
      min: 2,
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
      label: "Bible Font Mode",
      value: defaultBibleFontMode,
      property: "defaultBibleFontMode",
      options: ["fit", "separate", "multiple"],
    },
  ];

  return (
    <ErrorBoundary>
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
                    "w-48 self-center border-4 flex gap-2 items-center justify-center aspect-video",
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
                    <img
                      className="max-w-full max-h-full"
                      alt="Default Song Background"
                      src={background}
                      loading="lazy"
                      style={{
                        filter: `brightness(${brightness}%)`,
                      }}
                    />
                  ) : (
                    <p>None</p>
                  )}
                </Button>
                <Button
                  variant="primary"
                  svg={RemoveSVG}
                  onClick={() => {
                    dispatch(setDefaultPreferences({ [preference]: "" }));
                  }}
                ></Button>
              </section>
              <section className="flex gap-2 items-center">
                <p className="font-semibold">Background Brightness:</p>
                <Icon size="xl" svg={BrightnessSVG} color="#fbbf24" />
                <Button
                  svg={MinusSVG}
                  variant="tertiary"
                  onClick={() => dispatch(setBrightness(brightness - 10))}
                />
                <Input
                  label="Brightness"
                  type="number"
                  value={brightness}
                  onChange={(val) => dispatch(setBrightness(val as number))}
                  className="w-8 2xl:w-12"
                  inputTextSize="text-xs"
                  hideLabel
                  data-ignore-undo="true"
                  max={100}
                  min={1}
                />
                <Button
                  svg={AddSVG}
                  variant="tertiary"
                  onClick={() => dispatch(setBrightness(brightness + 10))}
                />
              </section>
            </li>
          )
        )}
      </ul>
      <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
        Default Items Per Row
      </h2>
      <ul className="flex flex-col gap-6 items-center">
        {perRowPreferences.map(({ label, value, setValue, max, min }) => (
          <li
            key={label}
            className={cn("grid grid-cols-2 gap-2 items-center p-2")}
          >
            <p className="font-semibold">{label}:</p>
            <section className="flex gap-2 items-center">
              <Button
                svg={MinusSVG}
                variant="tertiary"
                onClick={() => dispatch(setValue(value - 1))}
              />
              <Input
                label={label}
                type="number"
                value={value}
                onChange={(val) => dispatch(setValue(val as number))}
                className="w-8 2xl:w-12"
                inputTextSize="text-xs"
                hideLabel
                data-ignore-undo="true"
                max={max}
                min={min}
              />
              <Button
                svg={AddSVG}
                variant="tertiary"
                onClick={() => dispatch(setValue(value + 1))}
              />
            </section>
          </li>
        ))}
      </ul>
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
