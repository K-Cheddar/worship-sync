import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "../../hooks";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import "./Songs.scss";
import { addItemToItemList } from "../../store/itemList";
import { Link } from "react-router-dom";

const Songs = () => {
  const { list } = useSelector((state) => state.allItems);
  const dispatch = useDispatch();
  const loader = useRef(null);

  const songList = useMemo(() => {
    return list.filter((item) => item.type === "song");
  }, [list]);

  const [filteredList, setFilteredList] = useState(songList);
  const [numShownItems, setNumShownItems] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const isFullListLoaded = filteredList.length <= numShownItems;

  useEffect(() => {
    setFilteredList(
      songList.filter(({ name }) =>
        name.toLowerCase().includes(searchValue.toLowerCase())
      )
    );
  }, [searchValue, songList]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setNumShownItems((prev) => prev + 20);
      }
    });

    if (loader.current) {
      observer.observe(loader.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="px-2 py-4 h-full">
      <h2 className="text-2xl text-center mb-2">Songs</h2>
      <div>
        <Input
          value={searchValue}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="md:w-1/2 text-base flex gap-2 items-center mb-4 px-6"
        />
      </div>
      <ul className="song-list">
        {filteredList.slice(0, numShownItems).map((song, index) => {
          const isEven = index % 2 === 0;
          const bg = isEven ? "bg-slate-800" : "bg-slate-600";
          return (
            <li
              key={song._id}
              className={`flex border border-transparent gap-2 ${bg} pl-4 rounded-md items-center hover:border-gray-300`}
            >
              <p className="text-base flex-1">{song.name}</p>
              <Button
                color="#22d3ee"
                variant="tertiary"
                className="text-sm h-full leading-3 ml-auto"
                padding="py-1 px-2"
                svg={AddSVG}
                onClick={() => dispatch(addItemToItemList(song))}
              >
                Add to List
              </Button>
            </li>
          );
        })}
        <li className="text-sm flex gap-2 items-center mt-2 justify-center">
          <p>Can't find what you're looking for?</p>
          <Button variant="secondary" className="relative">
            <Link
              className="h-full w-full"
              to={`/controller/create?type=song&name=${encodeURI(searchValue)}`}
            >
              Create a new song
            </Link>
          </Button>
        </li>
        <li
          className={`w-full text-sm text-center py-1 rounded-md ${
            isFullListLoaded ? "bg-transparent" : "bg-black"
          }`}
          ref={loader}
        >
          {!isFullListLoaded && "Loading..."}
        </li>
      </ul>
    </div>
  );
};

export default Songs;
