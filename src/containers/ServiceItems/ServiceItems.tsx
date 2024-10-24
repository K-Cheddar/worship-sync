import { useState } from "react";
import { dummyItems } from "./dummyItems";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import './ServiceItems.scss';
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import { ServiceItem } from "../../types";
import generateRandomId from "../../utils/generateRandomId";

const actions = [
  {action: () => {}, svg: DeleteSVG, id: generateRandomId()}
]

const ServiceItems = () => {
  const serviceItems : ServiceItem[] = dummyItems;
  const [selectedItem, setSelectedItem] = useState('');

  return (
    <>
      <h3 className="font-bold text-center h-7 pt-1 text-base bg-slate-800">Service Items</h3>
      <ul className="overflow-y-auto overflow-x-visible flex-1 service-items-list">
        {serviceItems.map((item) => {
          return (
            <LeftPanelButton
              key={item.id}
              title={item.title}
              id={item.id}
              selectedItem={selectedItem}
              handleClick={setSelectedItem}
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