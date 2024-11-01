import { useSelector, useDispatch } from "../../hooks";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";

import Button from "../../components/Button/Button";
import { useEffect, useMemo, useState } from "react";
import {
  setName,
  toggleEditMode,
  updateSongOrder,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
  updateFormattedLyrics,
} from "../../store/itemSlice";
import Input from "../../components/Input/Input";

import TextArea from "../../components/TextArea/TextArea";
import "./ItemEditor.scss";
import FormattedLyrics from "./FormattedLyrics";
import SongSections from "./SongSections";
import { FormattedLyrics as FormattedLyricsType, SongOrder } from "../../types";
import { sectionTypes } from "../../utils/slideColorMap";
import Arrangement from "./Arrangement";

const LyricsEditor = () => {
  const { isEditMode, name, arrangements, selectedArrangement } = useSelector(
    (state) => state.item
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [localName, setLocalName] = useState(name);
  const [unformattedLyrics, setUnformattedLyrics] = useState("");
  const [formattedLyrics, setFormattedLyrics] = useState<FormattedLyricsType[]>(
    []
  );
  const [songOrder, setSongOrder] = useState<SongOrder[]>([]);
  const [arrangementName, setArrangementName] = useState("");
  const [localArrangements, setLocalArrangements] = useState(arrangements);
  const dispatch = useDispatch();

  useEffect(() => {
    const arrangement = arrangements[selectedArrangement];
    setFormattedLyrics(arrangement?.formattedLyrics || []);
    setSongOrder(arrangement?.songOrder || []);
    setArrangementName(arrangement?.name || "Master");
    setLocalArrangements(arrangements);
  }, [arrangements, selectedArrangement]);

  useEffect(() => {
    setArrangementName(
      localArrangements[selectedArrangement]?.name || "Master"
    );
  }, [localArrangements, selectedArrangement]);

  const { availableSections, currentSections } = useMemo(() => {
    const sections = formattedLyrics.map(({ name }) => name);
    return {
      availableSections: Array.from(
        new Set([...sectionTypes, ...sections])
      ).map((section) => ({ label: section, value: section })),
      currentSections: sections.map((section) => ({
        label: section,
        value: section,
      })),
    };
  }, [formattedLyrics]);

  if (!isEditMode) {
    return <div className="w-0 h-0 absolute" />;
  }

  const onClose = () => {
    dispatch(toggleEditMode());
  };

  const save = () => {
    dispatch(setName(localName));
    dispatch(toggleEditMode());
    dispatch(updateSongOrder(songOrder));
    dispatch(updateFormattedLyrics(formattedLyrics));
  };

  return (
    <div className="lyrics-editor">
      <div className="flex bg-slate-900 px-2 h-8">
        <Button
          variant="tertiary"
          svg={ZoomOutSVG}
          onClick={() => dispatch(increaseFormattedLyrics())}
        />
        <Button
          variant="tertiary"
          svg={ZoomInSVG}
          onClick={() => dispatch(decreaseFormattedLyrics())}
        />
        <Button
          variant="tertiary"
          className="ml-auto"
          svg={CloseSVG}
          onClick={() => onClose()}
        />
      </div>
      <div className="lyrics-editor-middle">
        <div className="pl-4 pt-4 w-44 flex flex-col">
          <TextArea
            className="w-40 h-72"
            label="Paste Lyrics Here"
            value={unformattedLyrics}
            onChange={(val) => setUnformattedLyrics(val)}
          />
          <Button className="text-sm mt-1 mx-auto">Format Lyrics</Button>
          <h3 className="text-base mt-4 mb-2 font-semibold">Arrangements</h3>
          <ul className="song-arrangement-list">
            {localArrangements.map((arrangement) => (
              <Arrangement
                key={arrangement.name}
                arrangement={arrangement}
                setLocalArrangements={setLocalArrangements}
                localArrangements={localArrangements}
              />
            ))}
          </ul>
        </div>
        <section className="flex-1">
          <h2 className="text-2xl mb-2 text-center font-semibold">
            {arrangementName}
          </h2>
          <FormattedLyrics
            formattedLyrics={formattedLyrics}
            setFormattedLyrics={setFormattedLyrics}
            availableSections={availableSections}
          />
        </section>
        <section className="mr-4 flex flex-col">
          <SongSections
            songOrder={songOrder}
            setSongOrder={setSongOrder}
            currentSections={currentSections}
          />
        </section>
      </div>
      <div className="flex justify-end h-8 mb-2 mr-2 mt-4">
        <Button
          variant="secondary"
          className="text-base"
          onClick={() => onClose()}
        >
          Cancel
        </Button>
        <Button variant="cta" className="text-base ml-2" onClick={() => save()}>
          Save Changes
        </Button>
      </div>
    </div>
  );
};

export default LyricsEditor;
