const GSTConfig = require('../models/GSTConfig');

// Get GST config for the restaurant
exports.getGSTConfig = async (req, res, next) => {
  try {
    let config = await GSTConfig.findOne({ restaurant: req.userId });
    
    // If no config exists, return default values
    if (!config) {
      config = {
        sgstPercentage: 0,
        cgstPercentage: 0,
        igstPercentage: 0,
        serviceChargePercentage: 0,
        taxOnServiceCharge: false,
        taxOnServiceChargePercentage: 0,
        gstEnabled: false,
        serviceChargeEnabled: false
      };
    }
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    next(error);
  }
};

// Create or update GST config
exports.updateGSTConfig = async (req, res, next) => {
  try {
    const {
      sgstPercentage,
      cgstPercentage,
      igstPercentage,
      serviceChargePercentage,
      taxOnServiceCharge,
      taxOnServiceChargePercentage,
      gstEnabled,
      serviceChargeEnabled
    } = req.body;

    let config = await GSTConfig.findOne({ restaurant: req.userId });

    if (config) {
      // Update existing config
      config.sgstPercentage = parseFloat(sgstPercentage) || 0;
      config.cgstPercentage = parseFloat(cgstPercentage) || 0;
      config.igstPercentage = parseFloat(igstPercentage) || 0;
      config.serviceChargePercentage = parseFloat(serviceChargePercentage) || 0;
      config.taxOnServiceCharge = taxOnServiceCharge === 'true' || taxOnServiceCharge === true;
      config.taxOnServiceChargePercentage = parseFloat(taxOnServiceChargePercentage) || 0;
      config.gstEnabled = gstEnabled === 'true' || gstEnabled === true;
      config.serviceChargeEnabled = serviceChargeEnabled === 'true' || serviceChargeEnabled === true;
      await config.save();
    } else {
      // Create new config
      config = await GSTConfig.create({
        restaurant: req.userId,
        sgstPercentage: parseFloat(sgstPercentage) || 0,
        cgstPercentage: parseFloat(cgstPercentage) || 0,
        igstPercentage: parseFloat(igstPercentage) || 0,
        serviceChargePercentage: parseFloat(serviceChargePercentage) || 0,
        taxOnServiceCharge: taxOnServiceCharge === 'true' || taxOnServiceCharge === true,
        taxOnServiceChargePercentage: parseFloat(taxOnServiceChargePercentage) || 0,
        gstEnabled: gstEnabled === 'true' || gstEnabled === true,
        serviceChargeEnabled: serviceChargeEnabled === 'true' || serviceChargeEnabled === true
      });
    }

    res.json({
      success: true,
      message: 'GST configuration updated successfully',
      data: config
    });
  } catch (error) {
    next(error);
  }
};
