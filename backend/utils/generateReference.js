// utils/generateReference.js

module.exports = () => {
  return "TXN-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
};