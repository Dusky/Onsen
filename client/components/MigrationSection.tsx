import { useRef, useState } from "react";
import { useImportSillyTavern } from "../lib/queries.ts";
import { strings } from "../strings.ts";
import type { MigrationItemDto, MigrationKind, MigrationReportDto } from "@shared/types.ts";

/**
 * Moving in from SillyTavern (SPEC §20 phase 44).
 *
 * In Settings rather than in the library, because this is a thing you do once
 * on the day you switch, not a thing you do to your cast.
 */

/**
 * What is worth sending.
 *
 * A real install is hundreds of megabytes — avatars, thumbnails, backups,
 * generated images — and almost none of it is something the importer can read.
 * Filtering here rather than server-side is the difference between a folder
 * pick that takes a moment and one that uploads a picture library first.
 */
const WANTED: RegExp[] = [
  /(^|\/)characters\/[^/]+\.(png|charx|json)$/i,
  /(^|\/)chats\/[^/]+\/[^/]+\.jsonl$/i,
  /(^|\/)group chats\/[^/]+\.jsonl$/i,
  /(^|\/)groups\/[^/]+\.json$/i,
  /(^|\/)worlds\/[^/]+\.json$/i,
  /(^|\/)(instruct|context|regex)\/[^/]+\.json$/i,
  /(^|\/)settings\.json$/i,
];

/** Backups hold copies of chats already covered by `chats/`, times fifty. */
const IGNORED = /(^|\/)(backups|thumbnails|_?storage|user avatars|assets)\//i;

export function pickable(files: FileList | null): Array<{ path: string; file: File }> {
  const chosen: Array<{ path: string; file: File }> = [];
  for (const file of files ?? []) {
    // `webkitRelativePath` is what carries the folder structure; a plain
    // multi-select has none, and then the name is all there is.
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (IGNORED.test(path)) continue;
    if (!WANTED.some((pattern) => pattern.test(path))) continue;
    chosen.push({ path, file });
  }
  return chosen;
}

const KIND_ORDER: MigrationKind[] = [
  "character",
  "chat",
  "group_chat",
  "persona",
  "lorebook",
  "instruct",
  "regex",
  "context",
];

function Row({ item }: { item: MigrationItemDto }) {
  return (
    <div
      className="border-b border-rule py-[9px]"
      style={{ opacity: item.action === "add" ? 1 : 0.6 }}
    >
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
        <span className="meta flex-none">
          {strings.settings.migrateKind[item.kind] ?? item.kind}
        </span>
      </div>
      {item.detail !== "" ? (
        <p className="explain mt-[3px]">{item.detail}</p>
      ) : null}
    </div>
  );
}

function Report({ report }: { report: MigrationReportDto }) {
  const kinds = KIND_ORDER.filter((kind) => report.items.some((item) => item.kind === kind));
  return (
    <div className="mt-[14px]">
      <p className="section-label mb-[8px]">
        {strings.settings.migrateResult(report.added, report.skipped)}
      </p>
      {report.items.length === 0 ? (
        <p className="text-[14px] leading-[1.6] text-ink-prose-muted">
          {strings.settings.migrateNothing}
        </p>
      ) : null}
      {kinds.map((kind) => (
        <div key={kind}>
          {report.items
            .filter((item) => item.kind === kind)
            .map((item) => (
              <Row key={`${item.kind}:${item.path}`} item={item} />
            ))}
        </div>
      ))}
    </div>
  );
}

export function MigrationSection() {
  const folder = useRef<HTMLInputElement>(null);
  const importAll = useImportSillyTavern();
  const [report, setReport] = useState<MigrationReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mb-[26px]">
      <p className="group-heading mb-[12px]">{strings.settings.migrate}</p>
      <p className="explain mb-[12px]">
        {strings.settings.migrateHint}
      </p>

      <input
        ref={folder}
        type="file"
        hidden
        multiple
        // @ts-expect-error — not in React's typings; every engine here has it.
        webkitdirectory=""
        onChange={(event) => {
          const files = pickable(event.target.files);
          event.target.value = "";
          setError(null);
          if (files.length === 0) {
            setError(strings.settings.migrateEmpty);
            return;
          }
          importAll.mutate(files, {
            onSuccess: (result) => setReport(result),
            onError: (caught) => setError(caught.message),
          });
        }}
      />
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={importAll.isPending}
        onClick={() => folder.current?.click()}
      >
        {importAll.isPending
          ? strings.settings.migrateWorking
          : strings.settings.migrateChoose}
      </button>

      {error !== null ? (
        <p className="explain explain-alert mt-[8px]">{error}</p>
      ) : null}
      {report !== null ? <Report report={report} /> : null}
    </div>
  );
}
