import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setSongSearchValue } from "../../store/allItemsSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { selectSongLibrary } from "../../store/songLibrarySelectors";

const Songs = () => {
  const songSearchValue = useSelector(
    (state) => state.allItems.songSearchValue,
  );
  const {
    songs: songList,
    documents: allSongDocs,
    isLoading,
  } = useSelector(selectSongLibrary);
  const dispatch = useDispatch();

  return (
    <ErrorBoundary>
      <FilteredItems
        list={songList}
        type="song"
        heading="Songs"
        label="song"
        isLoading={isLoading}
        allDocs={allSongDocs}
        searchValue={songSearchValue}
        setSearchValue={(value) => dispatch(setSongSearchValue(value))}
      />
    </ErrorBoundary>
  );
};

export default Songs;
