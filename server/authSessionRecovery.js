export const isRecoverableInvalidHumanSessionError = (error) =>
  [401, 403, 404].includes(Number(error?.statusCode));
