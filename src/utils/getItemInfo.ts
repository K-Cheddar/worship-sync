import { mockArrangement } from "../store/mockArrangement"
import { Arrangment, DBItem, ServiceItem, SongOrder, UpdateItemState } from "../types"
import generateRandomId from "./generateRandomId"

const mockItem : DBItem = {
  name: "There's a welcome here",
  type: 'song',
  id: generateRandomId(),
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: mockArrangement,
} 

export const getItemInfo = async (item : ServiceItem) => {
  const retrievedItem = mockItem;
  const _item : UpdateItemState = {
    name: '',
    type: '',
    id: '',
    selectedArrangement: retrievedItem.selectedArrangement,
    shouldSkipTitle: retrievedItem.shouldSkipTitle,
    arrangements: [],
  }

  const updatedArrangements = retrievedItem.arrangements.map((arrangement) => {
    let { formattedLyrics, slides, songOrder } = {...arrangement};

    if (!formattedLyrics[0].id) {
      formattedLyrics = formattedLyrics.map((el) => {
        return {...el, id: generateRandomId()}
      })
    }

    if (!slides[0].id) {
      slides = slides.map((el) => {
        return {...el, id: generateRandomId(), boxes: [
          ...el.boxes.map((box, index) => {
            return {
              ...box, 
              id: generateRandomId(), 
              background: index === 1 ? '' : box.background,
              isLocked: index === 0 ? true : box.isLocked
            }
          })
        ] }
      })
    }

    let songOrderWIds : SongOrder[] = [];

    if (typeof songOrder[0] === 'string') {
      songOrderWIds = songOrder.map((el) => {
        return ({ name: el, id: generateRandomId()})
      })
    }

    return {
      name: retrievedItem.arrangements[retrievedItem.selectedArrangement].name,
      formattedLyrics,
      songOrder: songOrderWIds,
      slides
    }
  
  })



  _item.name = item.name
  _item.type = item.type
  _item.id = item._id
  _item.arrangements = updatedArrangements;
  return _item
}