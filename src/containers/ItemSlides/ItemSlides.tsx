import { ReactComponent as ZoomInSVG} from '../../assets/icons/zoom-in.svg';
import Button from '../../components/Button/Button'
import { ReactComponent as ZoomOutSVG} from '../../assets/icons/zoom-out.svg';
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import './ItemSlides.scss';
import { increaseSlides, decreaseSlides, setSelectedSlide } from '../../store/itemSlice';
import { useSelector } from "../../hooks";
import { useDispatch } from '../../hooks';
import { songSectionBgColorMap } from '../../utils/slideColorMap';
import { updatePresentation } from '../../store/presentationSlice';

const sizeMap : Map<number, { width: number, cols: string, hSize: string }> = new Map([
  [5, {width: 9.75, cols: 'grid-cols-5', hSize: 'text-xs'}],
  [4, {width: 12.25, cols: 'grid-cols-4', hSize: 'text-sm'}],
  [3, {width: 16.5,cols: 'grid-cols-3', hSize: 'text-base'}],
])

const ItemSlides = () => {
  const { arrangements, selectedArrangement, selectedSlide, type, name } = useSelector((state) => state.item);
  const arrangement = arrangements[selectedArrangement];
  const slides = arrangement?.slides || [];
  const size = useSelector((state) => state.item.slidesPerRow);
  const dispatch = useDispatch();

  const width = sizeMap.get(size)?.width || 12;

  const selectSlide = (index: number) => {
    dispatch(setSelectedSlide(index));
    dispatch(updatePresentation({ 
      slide: slides[index],
      type,
      name
    }))
  }

  if (!arrangement) return null

  return (
    <>
      <div className="flex justify-end w-full px-2 bg-slate-900 h-6 my-2 gap-1">
        <Button variant="tertiary" svg={ZoomOutSVG} onClick={() => dispatch(increaseSlides())}/>
        <Button variant="tertiary" svg={ZoomInSVG} onClick={() => dispatch(decreaseSlides())}/>
      </div>    
      <ul className={`item-slides-container ${sizeMap.get(size)?.cols}`}>
        {slides.map((slide, index) => {
          console.log('name', slide)
          return (
            <li 
              key={slide.id}
              className={`item-slide ${selectedSlide === index ? 'border-cyan-500' : 'border-transparent'}`}
              onClick={() => selectSlide(index)}>
              <h4 
                className={`${sizeMap.get(size)?.hSize} truncate px-2 text-center ${songSectionBgColorMap.get(slide.type.split(' ')[0])}`}
                style={{width: `${width}vw`}}
              >
                {slide.type}
              </h4>
              <DisplayWindow showBorder boxes={slide.boxes} width={width} displayType='slide' />
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default ItemSlides;