import { useState } from "react";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
// import { ReactComponent as ZoomInSVG} from '../../assets/icons/zoom-in.svg';
// import { ReactComponent as ZoomOutSVG} from '../../assets/icons/zoom-out.svg';
import { ItemSlide } from "../../types";
import { dummySlides } from "./dummySlides";
import './ItemSlides.scss';
// import Button from "../../components/Button/Button";

const slideColorMap : Map<string, string> = new Map([
  ['Title', 'bg-stone-700'],
  ['Verse', 'bg-blue-700'],
  ['Chorus', 'bg-red-700'],
  ['Bridge', 'bg-green-700'],
  ['Outro', 'bg-orange-700'],
  ['Intro', 'bg-yellow-700'],
  ['Pre-Chorus', 'bg-rose-700'],
  ['Pre-Bridge', 'bg-lime-700'],
]);

const sizeMap : Map<number, { width: number, cols: string, hSize: string }> = new Map([
  [1, {width: 9.75, cols: 'grid-cols-5', hSize: 'text-xs'}],
  [2, {width: 12.25, cols: 'grid-cols-4', hSize: 'text-sm'}],
  [3, {width: 16.5,cols: 'grid-cols-3', hSize: 'text-base'}],
])

const ItemSlides = () => {
  const itemSlides: ItemSlide[] = dummySlides;
  // const [size, setSize] = useState(2);
  const size = 2;

  const width = sizeMap.get(size)?.width || 12;

  return (
    // <div className="h-full">
    //   <span className="flex">
    //     <Button variant="tertiary" svg={ZoomInSVG} onClick={() => setSize(size => Math.min(size + 1, 3))}/>
    //     <Button variant="tertiary" svg={ZoomOutSVG} onClick={() => setSize(size => Math.max(size - 1, 1))}/>
    //   </span>
      <ul className={`item-slides-container max-h-full mt-4 pr-2 grid gap-2 overflow-y-auto ${sizeMap.get(size)?.cols}`}>
        {itemSlides.map((slide) => {
          return (
            <li key={slide.id}>
              <h4 
                className={`${sizeMap.get(size)?.hSize} truncate px-2 text-center ${slideColorMap.get(slide.type)}`}
                style={{width: `${width}vw`}}
              >
                {slide.name}
              </h4>
              <DisplayWindow boxes={slide.boxes} width={width} />
            </li>
          )
        })}
      </ul>
    // </div>
  )
}

export default ItemSlides;