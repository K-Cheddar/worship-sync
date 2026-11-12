import config from "./electron-builder.config.js";
import { resolve } from "node:path";
export default { ...config, publish: null,
  electronDist: resolve("node_modules/electron/dist"),
  directories: { ...config.directories, output: "C:/Users/KPC/Desktop/github/.tmp-linked-video-package-20261111" },
};
