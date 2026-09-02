// controllers/referralController.js
const Referral = require('../models/Referral');
const User = require('../models/User');

exports.createReferral = async (req, res) => {
  const { referredEmail } = req.body;
  try {
    const referredUser = await User.findOne({ email: referredEmail });
    if (referredUser) return res.status(400).json({ msg: 'User already exists' });

    const referral = new Referral({
      referrer: req.user.id,
      referredEmail,
    });
    await referral.save();
    res.status(201).json(referral);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.getUserReferrals = async (req, res) => {
  try {
    const referrals = await Referral.find({ referrer: req.user.id }).sort({ createdAt: -1 });
    res.json(referrals);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
};
