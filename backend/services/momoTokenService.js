// Token Service (services/momoTokenService.js)

const axios = require("axios");

let cachedToken = null;
let expiry = 0;

exports.getMomoToken = async () => {
  if (cachedToken && Date.now() < expiry) return cachedToken;

  const response = await axios.post(
    `${process.env.MOMO_BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`
          ).toString("base64"),
        "Ocp-Apim-Subscription-Key":
          process.env.COLLECTION_SUBSCRIPTION_KEY
      }
    }
  );

  cachedToken = response.data.access_token;
  expiry = Date.now() + response.data.expires_in * 1000;

  return cachedToken;
};
