import { QuickLinkType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";

export const dummyLinks: QuickLinkType[] = [
  {
    title: 'Clear',
    id: generateRandomId()
  },
  {
    title: "Decision Card",
    id: generateRandomId()
  }
]