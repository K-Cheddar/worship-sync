import { Resizable } from "re-resizable";

type Image = {
  id: string,
  src: string
}

const dummyImages: Image[] = [
  {
    id: '1',
    src: 'https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/Prayer_xce1yo'
  },
  {
    id: '2',
    src: 'https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/The_Word_pvwsqg'
  },
  {
    id: '3',
    src: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/The-Cross-of-Christ-Church-Worship-Background_jhtxwz'
  },
  {
    id: '4',
    src: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/6351466127_d7013ff1f5_ofllf4'
  },
  {
    id: '5',
    src: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/welcome-slide-glc.001_momgg1'
  }
]

const Media = () => {
  const images: Image[] = dummyImages;

  return (
    <Resizable className="flex gap-1">
      {images.map((image) => {
        return (
          <img width="150px" alt={image.id} src={image.src}/>
        )
      })}
    </Resizable>
  )
}

export default Media;