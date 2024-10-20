type QuickLink = {
  title: string
  url?: string
}

const quickLinks: QuickLink[] = [
  {
    title: 'Clear'
  },
  {
    title: "Farewell",
    url: "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/psalm-145-5-1292446461_j02gov"
  },
  {
    title: "Welcome",
    url: "https://res.cloudinary.com/portable-media/image/upload/v1729199662/eliathah/Welcome_To_Eliathah.jpg"
  }
]

const QuickLinks = () => {
  return (
    <div className="flex gap-2">
      {quickLinks.map(({ title, url}) => { 
        return (
          <section>
            <button className="w-16 h-9 hover:opacity-80">
              {!url && <div className="h-full w-full bg-black"/>}
              {url && <img className="h-full w-full" src={url} alt={title}/>}
            </button>
            <p className="text-center text-xs">{title}</p>
          </section>
        )
      })}

    </div>
  )
}

export default QuickLinks;