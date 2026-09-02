// Status Tracking (services/momoStatusService.js)

const axios = require("axios");
const { getMomoToken } = require("./momoTokenService");

exports.getTransactionStatus = async (referenceId) => {
  const token = await getMomoToken();

  const res = await axios.get(
    `${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Target-Environment": process.env.MOMO_ENV,
        "Ocp-Apim-Subscription-Key":
          process.env.COLLECTION_SUBSCRIPTION_KEY
      }
    }
  );

  return res.data;
};
