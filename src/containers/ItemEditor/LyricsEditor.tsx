import { useSelector, useDispatch } from "../../hooks";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";
import Button from "../../components/Button/Button";
import { useMemo, useState } from "react";
import { setName, toggleEditMode, updateSongOrder, increaseFormattedLyrics, decreaseFormattedLyrics, updateFormattedLyrics } from "../../store/itemSlice";
import Input from "../../components/Input/Input";
import { slideColorMap } from "../../utils/slideColorMap";

import TextArea from "../../components/TextArea/TextArea";
import './ItemEditor.scss'
import generateRandomId from "../../utils/generateRandomId";

const sizeMap : Map<number, string> = new Map([
  [5, 'grid-cols-5'],
  [4, 'grid-cols-4'],
  [3, 'grid-cols-3'],
])

const LyricsEditor = () => {
  const { isEditMode, name, songOrder, arrangements, selectedArrangement, formattedLyricsPerRow } = useSelector(state => state.item);
  const [isEditingName, setIsEditingName] = useState(false)
  const [localName, setLocalName] = useState(name)
  const [unformattedLyrics, setUnformattedLyrics] = useState('')

  const dispatch = useDispatch();

  const formattedLyricsWIds = useMemo( () => arrangements[selectedArrangement].formattedLyrics.map((lyric) => ({
    id: generateRandomId(),
    lyric
  })), [arrangements, selectedArrangement])

  const songOrderWIds = useMemo( () => songOrder.map((section) => ({
    id: generateRandomId(),
    section
  })), [songOrder])

  if (!isEditMode) {
    return <div className="w-0 h-0 absolute"/>
  }

  const onClose = () => {
    dispatch(toggleEditMode())
  }
  
  return (
    <div className="lyrics-editor">
      <div className="flex bg-slate-900 px-2">
        <Button variant="tertiary" svg={ZoomOutSVG} onClick={() => dispatch(increaseFormattedLyrics())}/>
        <Button variant="tertiary" svg={ZoomInSVG} onClick={() => dispatch(decreaseFormattedLyrics())}/>
        <Button variant="tertiary" className="ml-auto" svg={CloseSVG} onClick={() => onClose()}/>
      </div>
      <div className="flex flex-1">
        <div className="p-4 w-fit">
          <TextArea className="w-40 h-60" label="Paste Lyrics Here" value={unformattedLyrics} onChange={(val) => setUnformattedLyrics(val)} />
          <Button className="text-sm mt-1 mx-auto">Format Lyrics</Button>
        </div>
        <section>
          <h2 className="text-lg mb-2 text-center font-semibold">{arrangements[selectedArrangement].name}</h2>
          <ul className={`grid gap-2 ${sizeMap.get(formattedLyricsPerRow)}`}>
            {formattedLyricsWIds.map(({ id, lyric: {type, name, words }}, index) => (
              <li key={id} className="text-sm px-2">
                <div className="flex h-4">
                  <p className={`flex-1 text-center rounded-t-md font-semibold text-sm ${slideColorMap.get(type)}`}>{name}</p>
                  <Button
                    className="" 
                    variant="tertiary"
                    color="#dc2626"
                    svg={DeleteSVG}
                    onClick={() => {
                      const copiedFormattedLyrics = [...arrangements[selectedArrangement].formattedLyrics];
                      copiedFormattedLyrics.splice(index, 1);
                      dispatch(updateFormattedLyrics(copiedFormattedLyrics))
                    }}
                  />
                </div>
                <TextArea hideLabel className="h-56" value={words} onChange={(val) => setUnformattedLyrics(val)}/>

              </li>
            ))}
          </ul>
        </section>
        <section className="ml-auto mr-4">
          <h2 className="text-lg mb-2 text-center font-semibold">Song Order</h2>
          <ul className="flex flex-col gap-2">
            {songOrderWIds.map(({ id, section }, index) => (
              <li key={id} className="text-sm flex items-center px-2 bg-black rounded-lg hover:bg-gray-800 cursor-pointer">
                <p className="pr-1 text-base">{section}</p>
                <Button  
                  className="ml-auto" 
                  variant="tertiary"
                  color="#dc2626"
                  svg={DeleteSVG}
                  onClick={() => {
                    const copiedSongOrder = [...songOrder];
                    copiedSongOrder.splice(index, 1);
                    dispatch(updateSongOrder(copiedSongOrder))
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="flex justify-end p-4">
        <Button variant="secondary" className="text-base" onClick={() => onClose()}>Cancel</Button>
        <Button variant="cta" className="text-base ml-2">Save Changes</Button>
      </div>
    </div>
  )
}

export default LyricsEditor