import { useState } from "react";
import type { MediaAssetDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { Sheet } from "./Sheet.tsx";
import { useConfirm } from "./ConfirmSheet.tsx";
import {
  useDeleteMedia,
  useRecaption,
  useSetMediaVisibility,
} from "../lib/queries.ts";

/**
 * Pictures and audio on a turn (SPEC §20 phase 41).
 *
 * A hidden picture still leaves a mark: a line saying it is here and not shown.
 * The alternative is a picture that vanishes from the log with nothing to say
 * it exists, which is indistinguishable from having deleted it — and deleting
 * is a different button with a different consequence.
 */
export function MessageMedia({
  sceneId,
  assets,
}: {
  sceneId: string;
  assets: MediaAssetDto[];
}) {
  const [inspecting, setInspecting] = useState<MediaAssetDto | null>(null);
  if (assets.length === 0) return null;

  const images = assets.filter((asset) => asset.kind === "image");
  const audio = assets.filter((asset) => asset.kind === "audio");

  return (
    <div className="mt-[10px]">
      {images.map((asset) =>
        asset.hidden ? (
          <button
            key={asset.id}
            type="button"
            onClick={() => setInspecting(asset)}
            className="meta mb-[6px] block"
          >
            {/* Hidden is not deleted, and the log has to be able to say so. */}
            {`${strings.media.hiddenNote} · ${strings.media.unhide}`}
          </button>
        ) : (
          <figure key={asset.id} className="mb-[10px]">
            <button type="button" onClick={() => setInspecting(asset)} className="block w-full">
              <img
                src={asset.url}
                alt={asset.caption ?? asset.prompt ?? ""}
                loading="lazy"
                className="block"
                style={{
                  // Its own size, capped — never stretched. A 64px thumbnail
                  // blown up to the prose measure is an empty box with a dot
                  // in it, which is what this did the first time.
                  border: "1px solid var(--onsen-color-rule)",
                  maxWidth: "100%",
                  maxHeight: "60vh",
                  width: "auto",
                  height: "auto",
                  background: "var(--onsen-color-bg-raised)",
                }}
              />
            </button>
            {asset.role === "attachment" && !asset.inPrompt ? (
              <figcaption className="meta mt-[5px]">
                {strings.media.quietNote}
              </figcaption>
            ) : null}
          </figure>
        ),
      )}

      {audio.map((asset) => (
        <audio
          key={asset.id}
          src={asset.url}
          controls
          preload="none"
          className="mb-[8px] block w-full"
        />
      ))}

      {inspecting !== null ? (
        <MediaSheet
          sceneId={sceneId}
          asset={inspecting}
          onClose={() => setInspecting(null)}
        />
      ) : null}
    </div>
  );
}

function MediaSheet({
  sceneId,
  asset,
  onClose,
}: {
  sceneId: string;
  asset: MediaAssetDto;
  onClose(): void;
}) {
  const setVisibility = useSetMediaVisibility(sceneId);
  const recaption = useRecaption(sceneId);
  const remove = useDeleteMedia(sceneId);
  const [confirmNode, confirm] = useConfirm();

  return (
    <Sheet title={strings.media.title} onClose={onClose}>
      <div className="pt-[8px] pb-[14px]">
        {asset.kind === "image" ? (
          <img
            src={asset.url}
            alt={asset.caption ?? ""}
            className="mb-[14px] block"
            style={{
              border: "1px solid var(--onsen-color-rule)",
              maxWidth: "100%",
              maxHeight: "40vh",
              width: "auto",
              height: "auto",
            }}
          />
        ) : null}

        {asset.prompt !== null && asset.role === "illustration" ? (
          <>
            <p className="section-label mb-[6px]">{strings.media.drawnFrom}</p>
            <p className="mb-[16px] text-[13px] leading-[1.55] text-ink-prose-muted">
              {asset.prompt}
            </p>
          </>
        ) : null}

        {asset.role === "attachment" ? (
          <>
            <p className="section-label mb-[6px]">{strings.media.describedAs}</p>
            <p className="mb-[10px] text-[13px] leading-[1.55] text-ink-prose-muted">
              {asset.caption ?? strings.media.notDescribed}
            </p>
            <button
              type="button"
              className="btn mb-[16px] w-full"
              disabled={recaption.isPending}
              onClick={() => recaption.mutate(asset.id)}
            >
              {recaption.isPending ? strings.media.recaptioning : strings.media.recaption}
            </button>
          </>
        ) : null}

        {/* Both switches, side by side, because the point is that they are two
            questions. Said once above them rather than twice beside them. */}
        <button
          type="button"
          className="btn mb-[8px] w-full"
          onClick={() => setVisibility.mutate({ id: asset.id, hidden: !asset.hidden })}
        >
          {asset.hidden ? strings.media.unhide : strings.media.hide}
        </button>
        {asset.role === "attachment" ? (
          <button
            type="button"
            className="btn mb-[8px] w-full"
            onClick={() => setVisibility.mutate({ id: asset.id, inPrompt: !asset.inPrompt })}
          >
            {asset.inPrompt ? strings.media.dropFromPrompt : strings.media.addToPrompt}
          </button>
        ) : null}

        <button
          type="button"
          className="btn w-full"
          style={{
            color: "var(--onsen-color-red)",
            borderColor: "var(--onsen-color-red-border)",
          }}
          onClick={() =>
            confirm(
              strings.media.removeConfirm,
              () => remove.mutate(asset.id, { onSuccess: () => onClose() }),
              { confirmLabel: strings.media.remove },
            )
          }
        >
          {strings.media.remove}
        </button>
      </div>
      {confirmNode}
    </Sheet>
  );
}
