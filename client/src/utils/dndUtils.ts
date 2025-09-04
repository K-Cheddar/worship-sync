import {
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors as useDndSensors,
} from "@dnd-kit/core";

export const useSensors = () => {
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 4,
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 200,
      tolerance: 5,
    },
  });

  return useDndSensors(mouseSensor, touchSensor);
};
