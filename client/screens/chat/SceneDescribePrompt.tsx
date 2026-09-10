import { useState } from "react";
import { useDescribeScene } from "../../lib/queries.ts";
import { strings } from "../../strings.ts";

/**
 * The empty scene's first question (§20 phase 157): describe it in a couple of
 * sentences and the model sets it up — a title, a framing scenario, and a
 * narrator opening the scene lands on. The composer stays below, so "or just
 * write your turn" is never taken away.
 */
export function SceneDescribePrompt({ sceneId }: { sceneId: string }) {
  const describe = useDescribeScene(sceneId);
  const [premise, setPremise] = useState("");

  return (
    <form
      className="mx-auto w-full max-w-[var(--onsen-prose-measure)]"
      onSubmit={(event) => {
        event.preventDefault();
        const value = premise.trim();
        if (value === "") return;
        describe.mutate(value, { onSuccess: () => setPremise("") });
      }}
    >
      <p className="section-label mb-[6px]">{strings.chat.describeScene}</p>
      <textarea
        className="field min-h-[72px] resize-y"
        value={premise}
        placeholder={strings.chat.describeScenePlaceholder}
        aria-label={strings.chat.describeScene}
        onChange={(event) => setPremise(event.target.value)}
      />
      <button
        type="submit"
        className="btn btn-primary mt-[8px] w-full"
        disabled={premise.trim() === "" || describe.isPending}
      >
        {describe.isPending ? strings.common.working : strings.chat.describeSceneButton}
      </button>
      {describe.error === null ? null : (
        <p className="explain explain-alert mt-[6px]">{describe.error.message}</p>
      )}
    </form>
  );
}
