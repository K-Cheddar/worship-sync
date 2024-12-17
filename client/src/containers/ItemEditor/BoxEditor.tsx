import Button from "../../components/Button/Button";

import textFull from "../../assets/images/textbox_full.png";
import textLeftHalf from "../../assets/images/textbox_leftHalf.png";
import textRightHalf from "../../assets/images/textbox_rightHalf.png";
import textMatch from "../../assets/images/textbox_match.png";
import textLowerThird from "../../assets/images/textbox_lowerThird.png";
import textUpperThird from "../../assets/images/textbox_upperThird.png";
import textMidThird from "../../assets/images/textbox_midThird.png";

import { Box } from "../../types";

type BoxEditorProps = {
  boxes: Box[];
  selectedBox: number;
  onChange: ({
    index,
    value,
    box,
  }: {
    index: number;
    value: string;
    box: Box;
  }) => void;
};

const BoxEditor = ({ boxes, selectedBox, onChange }: BoxEditorProps) => {
  const updateBoxSize = ({
    width,
    height,
    x,
    y,
  }: {
    width: number;
    height: number;
    x: number;
    y: number;
  }) => {
    const box: Box = { ...boxes[selectedBox], width, height, x, y };

    onChange({ index: selectedBox, value: box.words || "", box });
  };

  return (
    <ul className="grid grid-cols-3 gap-2">
      <li>
        <Button
          image={textFull}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textLeftHalf}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textRightHalf}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 50,
              height: 100,
              x: 50,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textLowerThird}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 65,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textMidThird}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 35,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textUpperThird}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: 100,
              height: 35,
              x: 0,
              y: 0,
            })
          }
        />
      </li>
      <li>
        <Button
          image={textMatch}
          variant="tertiary"
          onClick={() =>
            updateBoxSize({
              width: boxes[selectedBox].width,
              height: boxes[selectedBox].height,
              x: boxes[selectedBox].x || 0,
              y: boxes[selectedBox].y || 0,
            })
          }
        />
      </li>
    </ul>
  );
};

export default BoxEditor;
