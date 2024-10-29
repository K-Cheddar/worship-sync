import { useEffect, useMemo, useState } from "react";
import { useSelector } from "../../hooks";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import './Songs.scss'

const Songs = () => {
  const { list } = useSelector(state => state.allItems);

  const songList = useMemo(() => {
    return list.filter(item => item.type === 'song')
  }, [list])

  const [filteredList, setFilteredList] = useState(songList);
  const [searchValue, setSearchValue] = useState('');
  
  useEffect(() => {
    setFilteredList(songList.filter(({ name }) => name.toLowerCase().includes(searchValue.toLowerCase())));
  }, [searchValue, songList])

  return (
    <div className="px-2 py-4 h-full">
      <h2 className="text-2xl text-center">Songs</h2>
      <div>
        <Input
          value={searchValue}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="w-56 text-base flex gap-2 items-center mb-4"
        />

      </div>
      <ul className="song-list">
        {filteredList.map((song, index) => {
          const bg = index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-700';
          return (
            <li key={song._id} className={`flex gap-2 ${bg} py-1 px-4 rounded-md items-center`}>
              <p className="text-base flex-1">{song.name}</p>
              <Button color="#22d3ee" variant="tertiary" className="text-sm h-6 leading-3 ml-auto" padding="py-1 px-2" svg={AddSVG}>
                Add to List
              </Button>
            </li>
          )}
        )}
      </ul>
    </div>
  );
}

export default Songs;