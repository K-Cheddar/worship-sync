import { useState } from "react";
import Toggle from "../../../components/Toggle/Toggle";

const ItemEditTools = () => {
  const [skipTitle, setSkipTitlte] = useState(false);
  return (
    <div className="flex gap-1 items-center">
      <Toggle
        label="Skip Title"
        value={skipTitle}
        onChange={(val) => setSkipTitlte(val)}
      />
    </div>
  );
};

export default ItemEditTools;
