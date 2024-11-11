import {
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors as useDndSensors,
} from "@dnd-kit/core";

export const useSensors = () => {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 4,
    },
  });
  const mouseSensor = useSensor(MouseSensor);
  const touchSensor = useSensor(TouchSensor);
  const keyboardSensor = useSensor(KeyboardSensor);

  return useDndSensors(mouseSensor, touchSensor, keyboardSensor, pointerSensor);
};
