import { QuickLinkType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";

export const monitorLinks: QuickLinkType[] = [
  {
    title: 'Clear',
    id: generateRandomId(),
    action: 'clear'
  }
]

export const streamLinks: QuickLinkType[] = [
  {
    title: 'Clear',
    id: generateRandomId(),
    action: 'clear'
  }
]

export const projectorLinks: QuickLinkType[] = [
  {
    title: 'Clear',
    id: generateRandomId(),
    action: 'clear'
  },
  {
    title: "Farewell",
    url: "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/psalm-145-5-1292446461_j02gov",
    id: generateRandomId()
  },
  {
    title: "Welcome",
    url: "https://res.cloudinary.com/portable-media/image/upload/v1729199662/eliathah/Welcome_To_Eliathah.jpg",
    id: generateRandomId()
  }
]