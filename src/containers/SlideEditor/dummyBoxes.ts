import generateRandomId from '../../utils/generateRandomId'
import { Box } from '../../types'

export const _boxes: Box[] = [
  {
    label: 'background',
    id: generateRandomId(),
    isLocked: true,
    image: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/28-08-A1_j5o3cp',
    width: 100,
    height: 100,
    align: 'center',
    marginBottom: 0,
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0
  },
  {
    text: `There's a welcome here
There's a welcome here
There's an Eliathah welcome here`,
    id: generateRandomId(),
    isLocked: false,
    width: 100,
    height: 100,
    fontSize: 2.8,
    align: 'center',
    marginBottom: 3,
    marginTop: 3,
    marginLeft: 4,
    marginRight: 4
  },
  {
    text: 'Artist Name',
    id: generateRandomId(),
    isLocked: true,
    width: 100,
    height: 100,
    align: 'center',
    marginBottom: 1,
    marginTop: 1,
    marginLeft: 1,
    marginRight: 1,
    fontSize: 1
  }
]