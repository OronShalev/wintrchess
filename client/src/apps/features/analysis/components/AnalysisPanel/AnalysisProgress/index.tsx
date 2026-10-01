import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import ProgressReporter from "@/components/common/ProgressReporter";

import useAnalyseGame from "@analysis/hooks/useAnalyseGame";

function getStatusTitle(status: AnalysisStatus) {
    const statusTitles: Record<string, string | undefined> = {
        [AnalysisStatus.EVALUATING]: "progressReporter.evaluating",
        [AnalysisStatus.ANALYSING]: "progressReporter.evaluating"
    };

    return statusTitles[status];
}

function AnalysisProgress() {
    const { t } = useTranslation("analysis");

    const {
        evaluationProgress,
        analysisStatus,
        analysisError
    } = useAnalysisProgressStore();

    const analyseGame = useAnalyseGame();

    useEffect(() => {
        if (analysisStatus == AnalysisStatus.ANALYSING) analyseGame();
    }, [analysisStatus]);

    const statusTitle = getStatusTitle(analysisStatus);

    if (analysisStatus == AnalysisStatus.INACTIVE) return null;

    return <ProgressReporter
        progress={evaluationProgress}
        title={statusTitle ? t(statusTitle) : undefined}
        tooltip={t("progressReporter.evaluatingTooltip")}
        error={analysisError}
    />;
}

export default AnalysisProgress;