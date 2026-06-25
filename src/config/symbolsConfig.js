module.exports = {
  RELIANCE: {
    strategy: "spike",
    thresholdPercent: 3,
    windowSec: 30,
  },

  TCS: {
    strategy: "movingAverage",
    deviationPercent: 5,
    sampleSize: 10,
  },
};