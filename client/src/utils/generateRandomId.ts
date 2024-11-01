const generateRandomId = () => {
  const dateString = Date.now().toString(32);
  const randomNumber = Math.random().toString(32).substring(2)
  return dateString+randomNumber;
}

export default generateRandomId;

