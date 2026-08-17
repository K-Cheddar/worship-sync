import LocalVideoCaptureManager from "../components/LocalVideoCaptureManager/LocalVideoCaptureManager";

/** Hidden Electron route that keeps USB capture alive across controller reloads. */
const LocalVideoCaptureHost = () => <LocalVideoCaptureManager />;

export default LocalVideoCaptureHost;

