import { QuickLinkType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";

export const dummyLinks: QuickLinkType[] = [
  {
    title: 'Clear',
    id: generateRandomId()
  },
  {
    title: "5 minutes",
    id: generateRandomId()
  }
]