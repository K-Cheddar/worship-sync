import { ReactElement } from "react";

type ItemSlide = {
  title: string,
  background: string,
  innerHtml: ReactElement
}

const dummySlides: ItemSlide[] = [
  {
    title: "Title", 
    background: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/6087665-Good-Morning-Jesus_ei0fd2',
    innerHtml: <p>This is the first slide</p>
  },
  {
    title: "Verse", 
    background: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/28-08-A1_j5o3cp',
    innerHtml: <p>This is the content of slide number 2</p>
  },
  {
    title: "Multiple", 
    background: 'https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/Bible_k7yz2t',
    innerHtml: <section>
      <h4>This is a heading inside</h4>
      <p>This is text below the heading!</p>
    </section>
  }
]

const ItemSlides = () => {
  const itemSlides: ItemSlide[] = dummySlides;
  return (
    <>
      {itemSlides.map((slide) => {
        return (
          <section>
            <h3>{slide.title}</h3>
            <img width="100px" src={slide.background} alt={slide.title}/>
            {slide.innerHtml}
          </section>
        )
      })}
    </>
  )
}

export default ItemSlides;