// controllers/settingsController.js

const Setting = require('../models/Setting');

/**
 * @desc    Fetch application settings
 * @route   GET /api/settings
 * @access  Public or Admin (depending on middleware)
 */
exports.getSettings = async (req, res) => {
  try {
    // Attempt to find the existing settings document
    let settings = await Setting.findOne();

    // If no settings exist, create default settings
    if (!settings) {
      settings = new Setting();
      await settings.save();
    }

    return res.status(200).json(settings);
  } catch (error) {
    console.error('[SettingsController] Error fetching settings:', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * @desc    Update application settings
 * @route   PUT /api/settings
 * @access  Admin only (validated via middleware)
 */
exports.updateSettings = async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: 'No data provided for update' });
    }

    // Find existing settings document
    let settings = await Setting.findOne();

    if (!settings) {
      // No existing settings found; create a new one
      settings = new Setting(req.body);
    } else {
      // Merge updates into existing settings
      Object.assign(settings, req.body);
    }

    // Save the updated settings
    await settings.save();

    return res.status(200).json({
      message: 'Settings updated successfully',
      settings,
    });
  } catch (error) {
    console.error('[SettingsController] Error updating settings:', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
