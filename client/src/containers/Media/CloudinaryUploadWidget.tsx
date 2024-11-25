import { createContext, useEffect, useState } from "react";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";

import Button from "../../components/Button/Button";

// Create a context to manage the script loading state
const CloudinaryScriptContext = createContext<any>(null);

declare global {
  interface Window {
    cloudinary: any;
  }
}

export type imageInfoType = {
  public_id: string;
  secure_url: string;
};

type CloudinaryUploadWidgetProps = {
  uwConfig: {
    cloudName: string;
    uploadPreset: string;
  };
  onComplete: (info: imageInfoType) => void;
};

const CloudinaryUploadWidget = ({
  uwConfig,
  onComplete,
}: CloudinaryUploadWidgetProps) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Check if the script is already loaded
    if (!loaded) {
      const uwScript = document.getElementById("uw");
      if (!uwScript) {
        // If not loaded, create and load the script
        const script = document.createElement("script");
        script.setAttribute("async", "");
        script.setAttribute("id", "uw");
        script.src = "https://upload-widget.cloudinary.com/global/all.js";
        script.addEventListener("load", () => setLoaded(true));
        document.body.appendChild(script);
      } else {
        // If already loaded, update the state
        setLoaded(true);
      }
    }
  }, [loaded]);

  const initializeCloudinaryWidget = () => {
    if (loaded) {
      var myWidget = window.cloudinary.createUploadWidget(
        uwConfig,
        (error: any, result: any) => {
          if (!error && result && result.event === "success") {
            console.log("Done! Here is the image info: ", result.info);
            onComplete(result.info);
          }
        }
      );

      myWidget.open();
    }
  };

  return (
    <CloudinaryScriptContext.Provider value={{ loaded }}>
      <Button
        variant="tertiary"
        className="ml-auto"
        svg={AddSVG}
        onClick={initializeCloudinaryWidget}
      />
    </CloudinaryScriptContext.Provider>
  );
};

export default CloudinaryUploadWidget;
export { CloudinaryScriptContext };
