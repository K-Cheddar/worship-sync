import { useState } from "react";
import { dummyItems } from "./dummyItems";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import './ServiceItems.scss';
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import { ServiceItem } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { setActiveItem } from "../../store/itemSlice";
import { getItemInfo } from "../../utils/getItemInfo";
import { useDispatch } from "../../hooks";

const actions = [
  {action: () => {}, svg: DeleteSVG, id: generateRandomId()}
]

const serviceItems : ServiceItem[] = dummyItems;

const ServiceItems = ({ setMiddleSection }: { setMiddleSection: Function }) => {
  const dispatch = useDispatch();
  const [selectedItem, setSelectedItem] = useState<ServiceItem>({id: '', title: '', type: ''});

  
  const selectItem = async (item : ServiceItem) => {
    setSelectedItem(item);
    const _item = await getItemInfo(item);
    dispatch(setActiveItem(_item));
    console.log(_item, item)
  }

  return (
    <>
      <h3 className="font-bold text-center h-7 pt-1 text-base bg-slate-800">Service Items</h3>
      <ul className="overflow-y-auto overflow-x-visible flex-1 service-items-list">
        {serviceItems.map((item) => {
          return (
            <LeftPanelButton
              key={item.id}
              title={item.title}
              isSelected={item.id === selectedItem.id}
              handleClick={() => {
                selectItem(item)
                setMiddleSection('service-item')
              }}
              type={item.type}
              actions={actions}
            />
          )
        })}
      </ul>
    </>
  )

}

export default ServiceItems;