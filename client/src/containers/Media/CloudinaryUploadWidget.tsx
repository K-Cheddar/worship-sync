import { createContext, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import Button from "../../components/Button/Button";

// Create a context to manage the script loading state
const CloudinaryScriptContext = createContext<any>(null);

declare global {
  interface Window {
    cloudinary: any;
  }
}

export type mediaInfoType = {
  // Common properties
  id: string;
  batchId: string;
  asset_id: string;
  public_id: string;
  version: number;
  version_id: string;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: "image" | "video";
  created_at: string;
  tags: string[];
  pages: number;
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  folder: string;
  access_mode: string;
  existing: boolean;
  original_filename: string;
  path: string;
  thumbnail_url: string;
  done: boolean;

  // Video-specific properties (optional)
  playback_url?: string;
  audio?: {
    codec: string;
    bit_rate: string;
    frequency: number;
    channels: number;
    channel_layout: string;
  };
  video?: {
    pix_format: string;
    codec: string;
    level: number;
    profile: string;
    bit_rate: string;
    dar: string;
    time_base: string;
  };
  is_audio?: boolean;
  frame_rate?: number;
  bit_rate?: number;
  duration?: number;
  rotation?: number;
  nb_frames?: number;

  // Image-specific properties (optional)
  colors?: Array<[string, number]>;
  predominant?: {
    google: Array<[string, number]>;
    cloudinary: Array<[string, number]>;
  };
};

type CloudinaryUploadWidgetProps = {
  uwConfig: {
    cloudName: string;
    uploadPreset: string;
  };
  onComplete: (info: mediaInfoType) => void;
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
      const myWidget = window.cloudinary.createUploadWidget(
        uwConfig,
        (error: any, result: any) => {
          if (!error && result && result.event === "success") {
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
        className="lg:ml-auto"
        svg={Plus}
        onClick={initializeCloudinaryWidget}
      />
    </CloudinaryScriptContext.Provider>
  );
};

export default CloudinaryUploadWidget;
export { CloudinaryScriptContext };
