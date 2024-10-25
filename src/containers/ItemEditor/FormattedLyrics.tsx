import { useMemo } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import { useSelector } from "../../hooks";
import { sectionTypes, songSectionBgColorMap } from "../../utils/slideColorMap";
import { FormattedLyrics as FormattedLyricsType } from "../../types";

const sizeMap : Map<number, string> = new Map([
  [5, 'grid-cols-5'],
  [4, 'grid-cols-4'],
  [3, 'grid-cols-3'],
])

type FormattedLyricsProps = {
  formattedLyrics: FormattedLyricsType[],
  setFormattedLyrics: (formattedLyrics: FormattedLyricsType[]) => void,
  availableSections: { value: string, label: string }[]
}

const FormattedLyrics = ({ formattedLyrics, setFormattedLyrics, availableSections} : FormattedLyricsProps) => {
  const { formattedLyricsPerRow } = useSelector(state => state.item);

  return (
    <ul className={`grid gap-2 overflow-y-auto max-h-full ${sizeMap.get(formattedLyricsPerRow)}`}>
    {formattedLyrics.map(({ id, type, name, words }, index) => (
      <li key={id} className="text-sm px-2">
        <div className={`formatted-lyrics-section ${songSectionBgColorMap.get(type)}`}>
          <Select 
            onChange={ (val) => {
              const copiedFormattedLyrics = [...formattedLyrics];
              const lyric = {...copiedFormattedLyrics[index]};
              lyric.name = val
              copiedFormattedLyrics[index] = lyric;
              setFormattedLyrics(copiedFormattedLyrics)
            }} 
            value={name}
            options={availableSections}/>
          <Button
            className="ml-auto" 
            variant="tertiary"
            svg={DeleteSVG}
            onClick={() => {
              const copiedFormattedLyrics = [...formattedLyrics];
              copiedFormattedLyrics.splice(index, 1);
              setFormattedLyrics(copiedFormattedLyrics)
            }}
          />
        </div>
        <TextArea hideLabel className="h-56" value={words} onChange={(val) => {
          const copiedFormattedLyrics = [...formattedLyrics];
          const lyric = {...copiedFormattedLyrics[index]};
          lyric.words = val;
          copiedFormattedLyrics[index] = lyric;
          setFormattedLyrics(copiedFormattedLyrics)
        }}/>
      </li>
    ))}
  </ul>
  )
}

export default FormattedLyrics;