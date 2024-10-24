import { dummyMedia } from "./dummyMedia";
import './Media.scss'


const Media = () => {
  const images = dummyMedia;

  return (
    <>
      <h2 className="text-lg font-semibold text-center mt-4 pb-2 pt-1 mx-2 bg-slate-800 rounded-t-md">Media</h2>
      <ul className="media-items">
        {images.map(({id, src}) => {
          return (
            <li 
              className="self-center border border-slate-500 flex items-center justify-center aspect-video"
              key={id}
            >
              <img className="max-w-full max-h-full" alt={id} src={src}/>
          </li>
          )
        })}
      </ul>
    </>

  )
}

export default Media;