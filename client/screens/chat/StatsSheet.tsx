import type { SceneStatsDto } from "@shared/types.ts";
import { strings } from "../../strings.ts";
import { Sheet } from "../../components/Sheet.tsx";

/**
 * A scene rolled up (§20 phase 128): messages, words, and who carried them.
 * A plain readout, no charts — the per-message gutter already carries the
 * fine-grained numbers.
 */
export function StatsSheet({ stats, onClose }: { stats: SceneStatsDto | null; onClose(): void }) {
  return (
    <Sheet title={strings.chat.stats} onClose={onClose}>
      {stats === null ? (
        <p className="meta py-[10px]">{strings.common.working}</p>
      ) : (
        <div className="pb-[6px]">
          <div className="flex flex-wrap gap-[6px] py-[8px]">
            <Stat label={strings.chat.statsMessages} value={String(stats.messages)} />
            <Stat label={strings.chat.statsUser} value={String(stats.userMessages)} />
            <Stat label={strings.chat.statsAi} value={String(stats.aiMessages)} />
            <Stat label={strings.chat.statsWords} value={String(stats.words)} />
          </div>
          {stats.byCharacter.length === 0 ? null : (
            <>
              <p className="section-label mt-[10px] mb-[6px]">{strings.chat.statsByCharacter}</p>
              {stats.byCharacter.map((row) => (
                <div
                  key={row.name}
                  className="flex items-baseline gap-[10px] border-b border-rule py-[9px]"
                >
                  <span className="min-w-0 flex-1 truncate text-ui-loose">{row.name}</span>
                  <span className="meta flex-none">
                    {strings.chat.statsCharacterLine(row.messages, row.words)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 border border-rule px-[10px] py-[8px]">
      <p className="section-label mb-[4px]">{label}</p>
      <p className="meta tabular-nums text-[15px]">{value}</p>
    </div>
  );
}
