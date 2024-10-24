import { QuickLinkType } from "../../types";
import './QuickLink.scss'

const QuickLink = ({ title, url } : QuickLinkType) => {
  return (
    <li className="quick-link flex flex-col items-center p-1">
      <button>
        {!url && <div className="h-full w-full bg-black"/>}
        {url && <img className="h-full w-full" src={url} alt={title}/>}
      </button>
      <p className="text-center text-xs font-semibold">{title}</p>
    </li>
  )
}

export default QuickLink;