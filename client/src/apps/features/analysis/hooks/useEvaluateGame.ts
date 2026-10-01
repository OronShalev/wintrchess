import { useTranslation } from "react-i18next";

import AnalysedGame from "shared/types/game/AnalysedGame";
import AnalysisStatus from "@analysis/constants/AnalysisStatus";
import useSettingsStore from "@/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import createGameEvaluator from "../lib/evaluate";

function useEvaluateGame() {
    const { t } = useTranslation("analysis");

    const settings = useSettingsStore(
        state => state.settings.analysis.engine
    );

    const dispatchCurrentNodeUpdate = useAnalysisBoardStore(
        state => state.dispatchCurrentNodeUpdate
    );

    const {
        setAnalysisStatus,
        setEvaluationProgress,
        setAnalysisError
    } = useAnalysisProgressStore();

    async function evaluateGame(analysisGame: AnalysedGame) {
        setAnalysisStatus(AnalysisStatus.EVALUATING);

        const evaluator = createGameEvaluator(analysisGame, {
            engineDepth: settings.depth,
            engineTimeLimit: settings.timeLimitEnabled
                ? settings.timeLimit : undefined,
            lines: settings.lines,
            onProgress: progress => {
                setEvaluationProgress(progress);
                dispatchCurrentNodeUpdate();
            }
        });

        evaluator.evaluate()
            .then(() => setAnalysisStatus(
                AnalysisStatus.AWAITING_CAPTCHA
            ))
            .catch(err => {
                if (err == "abort" || (err as Error).name == "AbortError") return;

                console.error(err);
                setAnalysisError(t("analysisError"));
            });

        return evaluator.controller;
    }

    return evaluateGame;
}

export default useEvaluateGame;