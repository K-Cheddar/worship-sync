export const isElectron = jest.fn(() => false);
export const getApiBasePath = jest.fn(() => "/");
export const getIsDev = jest.fn(() => Promise.resolve(false));
export const getPlatform = jest.fn(() => Promise.resolve(null));
export const getAppVersion = jest.fn(() => Promise.resolve(null));
