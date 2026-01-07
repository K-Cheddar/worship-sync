import { useContext, useState, useEffect } from "react";
import { useDispatch } from "react-redux";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { useSelector } from "../../hooks";
import {
  setMonitorShowClock,
  setMonitorShowTimer,
  setMonitorClockFontSize,
  setMonitorTimerFontSize,
} from "../../store/preferencesSlice";
import RadioButton from "../../components/RadioButton/RadioButton";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { Plus, Minus } from "lucide-react";
import cn from "classnames";

const MonitorSettings = () => {
  const dispatch = useDispatch();
  const { access: currentAccess } = useContext(GlobalInfoContext) || {};
  const {
    monitorSettings: {
      showClock: monitorShowClock,
      showTimer: monitorShowTimer,
      clockFontSize: monitorClockFontSize,
      timerFontSize: monitorTimerFontSize,
    },
  } = useSelector((state) => state.undoable.present.preferences);

  const [localClockFontSize, setLocalClockFontSize] =
    useState(monitorClockFontSize);
  const [localTimerFontSize, setLocalTimerFontSize] =
    useState(monitorTimerFontSize);

  // Sync local state with Redux state when it changes externally
  useEffect(() => {
    setLocalClockFontSize(monitorClockFontSize);
  }, [monitorClockFontSize]);

  useEffect(() => {
    setLocalTimerFontSize(monitorTimerFontSize);
  }, [monitorTimerFontSize]);

  const monitorSettings = [
    {
      label: "Clock",
      value: monitorShowClock,
      setValue: setMonitorShowClock,
    },
    {
      label: "Timer",
      value: monitorShowTimer,
      setValue: setMonitorShowTimer,
    },
  ];

  const fontSizeSettings = [
    {
      label: "Clock Font Size",
      value: localClockFontSize,
      setValue: setMonitorClockFontSize,
      setLocalValue: setLocalClockFontSize,
      max: 25,
      min: 15,
    },
    {
      label: "Timer Font Size",
      value: localTimerFontSize,
      setValue: setMonitorTimerFontSize,
      setLocalValue: setLocalTimerFontSize,
      max: 25,
      min: 15,
    },
  ];

  const handleBlur = ({
    value,
    setLocalValue,
    setValue,
    min,
    max,
  }: {
    value: number;
    setLocalValue: (val: number) => void;
    setValue: (val: number) => { type: string; payload: number };
    min: number;
    max: number;
  }) => {
    return () => {
      let validatedValue = value;
      if (typeof value !== "number" || isNaN(value) || value < min) {
        validatedValue = min;
      } else if (value > max) {
        validatedValue = max;
      }
      setLocalValue(validatedValue);
      dispatch(setValue(validatedValue));
    };
  };

  return (
    <ErrorBoundary>
      <div className="flex flex-col gap-6 items-center">
        <h2 className="text-lg font-semibold text-center mb-4 border-b-2 border-gray-400 pb-2">
          Monitor Display Settings
        </h2>
        {currentAccess === "full" && (
          <>
            <ul className="flex flex-col gap-6 items-center">
              {monitorSettings.map(({ label, value, setValue }) => (
                <li
                  key={label}
                  className={cn("grid grid-cols-2 gap-2 items-center p-2")}
                >
                  <p className="font-semibold text-center">{label}:</p>
                  <section className="flex gap-2 items-center px-2">
                    <RadioButton
                      label="Shown"
                      value={value}
                      onChange={() => dispatch(setValue(true))}
                    />
                    <RadioButton
                      label="Hidden"
                      value={!value}
                      onChange={() => dispatch(setValue(false))}
                    />
                  </section>
                </li>
              ))}
            </ul>
            <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
              Font Sizes
            </h2>
            <ul className="flex flex-col gap-6 items-center">
              {fontSizeSettings.map(
                ({ label, value, setValue, setLocalValue, max, min }) => {
                  return (
                    <li
                      key={label}
                      className={cn("grid grid-cols-2 gap-2 items-center p-2")}
                    >
                      <p className="font-semibold">{label}:</p>
                      <section className="flex gap-2 items-center">
                        <Button
                          svg={Minus}
                          variant="tertiary"
                          onClick={() => {
                            const newValue = Math.max(min, value - 1);
                            setLocalValue(newValue);
                            dispatch(setValue(newValue));
                          }}
                        />
                        <Input
                          label={label}
                          type="number"
                          value={value}
                          onChange={(val) => setLocalValue(val as number)}
                          onBlur={handleBlur({
                            value,
                            setLocalValue,
                            setValue,
                            min,
                            max,
                          })}
                          inputTextSize="text-xs"
                          hideLabel
                          data-ignore-undo="true"
                          max={max}
                          min={min}
                        />
                        <Button
                          svg={Plus}
                          variant="tertiary"
                          onClick={() => {
                            const newValue = Math.min(max, value + 1);
                            setLocalValue(newValue);
                            dispatch(setValue(newValue));
                          }}
                        />
                      </section>
                    </li>
                  );
                }
              )}
            </ul>
          </>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default MonitorSettings;
