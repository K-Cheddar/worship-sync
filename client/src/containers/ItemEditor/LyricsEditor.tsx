import { useSelector, useDispatch } from "../../hooks";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";

import Button from "../../components/Button/Button";
import { useEffect, useMemo, useState } from "react";
import { toggleEditMode, updateArrangements } from "../../store/itemSlice";

import {
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
} from "../../store/preferencesSlice";

import TextArea from "../../components/TextArea/TextArea";
import "./ItemEditor.scss";
import LyricBoxes from "./LyricBoxes";
import SongSections from "./SongSections";
import { FormattedLyrics as FormattedLyricsType, SongOrder } from "../../types";
import { sectionTypes } from "../../utils/slideColorMap";
import Arrangement from "./Arrangement";
import { updateFormattedSections } from "../../utils/itemUtil";
import { sortList } from "../../utils/sort";
import { formatSong } from "../../utils/overflow";
import { createSections as createSectionsUtil } from "../../utils/itemUtil";

const LyricsEditor = () => {
  const item = useSelector((state) => state.undoable.present.item);
  const { isEditMode, arrangements, selectedArrangement } = item;
  const [unformattedLyrics, setUnformattedLyrics] = useState("");
  const [localArrangements, setLocalArrangements] = useState([...arrangements]);
  const [localSelectedArrangement, setLocalSelectedArrangement] =
    useState(selectedArrangement);
  const dispatch = useDispatch();

  const localFormattedLyrics = useMemo(
    () => localArrangements[localSelectedArrangement]?.formattedLyrics || [],
    [localArrangements, localSelectedArrangement]
  );
  const songOrder = useMemo(
    () => localArrangements[localSelectedArrangement]?.songOrder || [],
    [localArrangements, localSelectedArrangement]
  );
  const arrangementName = useMemo(
    () => localArrangements[localSelectedArrangement]?.name || "Master",
    [localArrangements, localSelectedArrangement]
  );

  useEffect(() => {
    setLocalArrangements(arrangements);
    setLocalSelectedArrangement(selectedArrangement);
  }, [arrangements, selectedArrangement]);

  useEffect(() => {
    if (!localArrangements[localSelectedArrangement]) {
      setLocalSelectedArrangement(0);
    }
  }, [localArrangements, localSelectedArrangement]);

  const updateSongOrder = (_songOrder: SongOrder[]) => {
    setLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (index === localSelectedArrangement) {
          return { ...el, songOrder: _songOrder };
        }
        return el;
      });
    });
  };

  const updateFormattedLyrics = (_formattedLyrics: FormattedLyricsType[]) => {
    setLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (index === localSelectedArrangement) {
          return { ...el, formattedLyrics: _formattedLyrics };
        }
        return el;
      });
    });
  };

  const onFormattedLyricsDelete = (index: number) => {
    const updatedFormattedLyrics = [...localFormattedLyrics];
    updatedFormattedLyrics.splice(index, 1);

    const updatedSongOrder = songOrder.filter((section) => {
      return updatedFormattedLyrics
        .map(({ name }) => name)
        .includes(section.name);
    });

    updateFormattedLyricsAndSongOrder(updatedFormattedLyrics, updatedSongOrder);
  };

  const { availableSections, currentSections } = useMemo(() => {
    const sections = sortList(localFormattedLyrics.map(({ name }) => name));
    return {
      availableSections: Array.from(
        new Set([...sortList(sectionTypes), ...sections])
      ).map((section) => ({ label: section, value: section })),
      currentSections: sections.map((section) => ({
        label: section,
        value: section,
      })),
    };
  }, [localFormattedLyrics]);

  const updateFormattedLyricsAndSongOrder = (
    _lyrics: FormattedLyricsType[],
    songOrderParam?: SongOrder[]
  ) => {
    const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
      updateFormattedSections({
        formattedLyrics: _lyrics,
        songOrder: songOrderParam || songOrder,
      });

    const updatedLocalArrangements = localArrangements.map((el, index) => {
      if (index === localSelectedArrangement) {
        return {
          ...el,
          formattedLyrics: [..._formattedLyrics],
          songOrder: [..._songOrder],
        };
      }
      return el;
    });
    setLocalArrangements(updatedLocalArrangements);
  };

  if (!isEditMode) {
    return <div className="w-0 h-0 absolute" />;
  }

  const onClose = () => {
    setLocalArrangements(arrangements);
    dispatch(toggleEditMode());
  };

  const save = () => {
    dispatch(toggleEditMode());
    const _arrangements = [...localArrangements];

    _arrangements[localSelectedArrangement] = {
      ..._arrangements[localSelectedArrangement],
      formattedLyrics: [...localFormattedLyrics],
    };

    const _item = formatSong({
      ...item,
      arrangements: _arrangements,
      selectedArrangement: localSelectedArrangement,
    });
    dispatch(
      updateArrangements({
        arrangements: _item.arrangements,
        selectedArrangement: localSelectedArrangement,
      })
    );
  };

  const createSections = () => {
    if (!unformattedLyrics.trim()) return;

    const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
      createSectionsUtil({
        formattedLyrics: localFormattedLyrics,
        songOrder,
        unformattedLyrics,
      });

    updateFormattedLyricsAndSongOrder(_formattedLyrics, _songOrder);
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
          <Button className="text-sm mt-1 mx-auto" onClick={createSections}>
            Format Lyrics
          </Button>
          <h3 className="text-base mt-4 mb-2 font-semibold">Arrangements</h3>
          <ul className="song-arrangement-list">
            {localArrangements.map((arrangement, index) => (
              <Arrangement
                key={arrangement.name}
                index={index}
                setSelectedArrangement={() =>
                  setLocalSelectedArrangement(index)
                }
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
          <LyricBoxes
            formattedLyrics={localFormattedLyrics}
            reformatLyrics={updateFormattedLyricsAndSongOrder}
            setFormattedLyrics={updateFormattedLyrics}
            availableSections={availableSections}
            onFormattedLyricsDelete={onFormattedLyricsDelete}
          />
        </section>
        <section className="mr-4 flex flex-col">
          <SongSections
            songOrder={songOrder}
            setSongOrder={updateSongOrder}
            currentSections={currentSections}
          />
        </section>
      </div>
      <div className="flex justify-end h-8 mr-4 my-4">
        <Button
          variant="secondary"
          className="text-base"
          onClick={() => onClose()}
        >
          Cancel
        </Button>
        <Button variant="cta" className="text-base ml-4" onClick={() => save()}>
          Save Changes
        </Button>
      </div>
    </div>
  );
};

export default LyricsEditor;
