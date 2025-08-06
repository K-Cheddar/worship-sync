export const getDbBasePath = () => {
  if (process.env.REACT_APP_API_BASE_PATH === "/") {
    return window.location.origin + "/";
  }
  return process.env.REACT_APP_API_BASE_PATH;
};
