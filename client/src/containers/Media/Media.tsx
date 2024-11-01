import Button from "../../components/Button/Button";
import Menu from "../../components/Menu/Menu";
import { useDispatch } from "../../hooks";
import { updateAllSlideBackgrounds, updateSlideBackground } from "../../store/itemSlice";
import { dummyMedia } from "./dummyMedia";
import './Media.scss'


const Media = () => {
  const dispatch = useDispatch();
  const images = dummyMedia;

  return (
    <>
      <h2 className="text-lg font-semibold text-center mt-4 pb-2 pt-1 mx-2 bg-slate-800 rounded-t-md">Media</h2>
      <ul className="media-items">
        {images.map(({id, src}, index) => {
          return (
            <li 
              className="self-center border border-slate-500 flex items-center justify-center aspect-video hover:border-slate-300 cursor-pointer"
              key={id}
            >
              <Menu 
                menuItems={[
                  {text: 'Set Item Background' , onClick: () => dispatch(updateAllSlideBackgrounds(src))},
                  {text: 'Set Slide Background', onClick: () => dispatch(updateSlideBackground(src))},
                ]}
                TriggeringButton={
                  <Button variant="none" padding="p-0" className="w-full h-full justify-center">
                    <img className="max-w-full max-h-full" alt={id} src={src}/>
                </Button>
                }
              />

          </li>
          )
        })}
      </ul>
    </>

  )
}

export default Media;