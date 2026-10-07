import {httpsCallable} from "firebase/functions";
import {functions} from "./firebase";
import {getSubmitFeedbackErrorMessage, type SubmitFeedbackRequest,
  type SubmitFeedbackResponse} from "./feedback";

export async function submitFeedbackRequest(request: SubmitFeedbackRequest) {
  try {
    const callable = httpsCallable<SubmitFeedbackRequest,
      SubmitFeedbackResponse>(functions, "submitFeedback");
    return (await callable(request)).data;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ?
      String(error.code) : "";
    const normalized = code.includes("resource-exhausted") ? "rate_limited" :
      code.includes("already-exists") ? "submission_conflict" :
        code.includes("invalid-argument") ? "unknown" :
          "temporarily_unavailable";
    throw new Error(getSubmitFeedbackErrorMessage(normalized));
  }
}
