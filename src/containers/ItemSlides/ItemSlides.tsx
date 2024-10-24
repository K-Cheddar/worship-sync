import { ReactComponent as ZoomInSVG} from '../../assets/icons/zoom-in.svg';
import Button from '../../components/Button/Button'
import { ReactComponent as ZoomOutSVG} from '../../assets/icons/zoom-out.svg';
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { ItemSlide } from "../../types";
import './ItemSlides.scss';
import { increaseSlides, decreaseSlides } from '../../store/itemSlice';
import { useSelector } from "../../hooks";
import { useDispatch } from '../../hooks';
import { slideColorMap } from '../../utils/slideColorMap';

const sizeMap : Map<number, { width: number, cols: string, hSize: string }> = new Map([
  [5, {width: 9.75, cols: 'grid-cols-5', hSize: 'text-xs'}],
  [4, {width: 12.25, cols: 'grid-cols-4', hSize: 'text-sm'}],
  [3, {width: 16.5,cols: 'grid-cols-3', hSize: 'text-base'}],
])

const ItemSlides = () => {
  const itemSlides: ItemSlide[] = [];
  const size = useSelector((state) => state.item.slidesPerRow);
  const dispatch = useDispatch();


  const width = sizeMap.get(size)?.width || 12;

  return (
    <>
      <div className="flex justify-end w-full px-2 bg-slate-900 h-6 my-2 gap-1">
        <Button variant="tertiary" svg={ZoomOutSVG} onClick={() => dispatch(increaseSlides())}/>
        <Button variant="tertiary" svg={ZoomInSVG} onClick={() => dispatch(decreaseSlides())}/>
      </div>    
      <ul className={`item-slides-container ${sizeMap.get(size)?.cols}`}>
        {itemSlides.map((slide) => {
          return (
            <li key={slide.id} className="item-slide">
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
    </>
  )
}

export default ItemSlides;