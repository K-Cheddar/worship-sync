import { useEffect, useMemo, useState } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import './ServiceItems.scss';
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import { ServiceItem } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { setActiveItem } from "../../store/itemSlice";
import { getItemInfo } from "../../utils/getItemInfo";
import { useDispatch, useSelector } from "../../hooks";
import { removeItemFromList, updateItemList } from "../../store/itemList";
import { mockItemList } from "../../store/mockItemList";



const ServiceItems = ({ setMiddleSection }: { setMiddleSection: Function }) => {
  const dispatch = useDispatch();
  const [selectedItem, setSelectedItem] = useState<ServiceItem>({"_id": '', name: '', type: ''});
  const { list : serviceItems} = useSelector(state => state.itemList);

  const actions = useMemo(() => {
    return ([
      { action: (itemId : string) =>  dispatch(removeItemFromList(itemId)), svg: DeleteSVG, id: generateRandomId()}
    ])
  }, [dispatch])

  const selectItem = async (item : ServiceItem) => {
    setSelectedItem(item);
    const _item = await getItemInfo(item);
    dispatch(setActiveItem(_item));
  }

  useEffect(() => {
    dispatch(updateItemList(mockItemList))
  }, [dispatch])

  return (
    <>
      <h3 className="font-bold text-center h-7 pt-1 text-base bg-slate-800">Service Items</h3>
      <ul className="overflow-y-auto overflow-x-visible flex-1 service-items-list">
        {serviceItems.map((item) => {
          return (
            <LeftPanelButton
              key={item["_id"]}
              title={item.name}
              isSelected={item['_id'] === selectedItem["_id"]}
              handleClick={() => {
                selectItem(item)
                setMiddleSection('service-item')
              }}
              type={item.type}
              actions={actions}
              id={item["_id"]}
            />
          )
        })}
      </ul>
    </>
  )

}

export default ServiceItems;