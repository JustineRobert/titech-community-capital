module.exports = {
    VolumeDetector: require("./volumeDetector"),
    DuplicateDetector: require("./duplicateDetector"),
    SequenceDetector: require("./sequenceDetector"),
    LatencyDetector: require("./latencyDetector"),
    FailureRateDetector: require("./failureRateDetector"),
    PayloadDetector: require("./payloadDetector"),
    TimingDetector: require("./timingDetector"),
    IpDetector: require("./ipDetector"),
    AnomalyScoreCalculator: require("./anomalyScoreCalculator"),
    AnomalyRecommendationEngine: require("./anomalyRecommendationEngine")
};