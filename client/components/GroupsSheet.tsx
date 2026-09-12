import { useMemo, useState } from "react";
import type { CharacterGroupDto } from "@shared/types.ts";
import { strings } from "../strings.ts";
import { navigate } from "../lib/router.ts";
import { useConfirm } from "./ConfirmSheet.tsx";
import { Sheet, SheetAction } from "./Sheet.tsx";
import {
  useAddGroupMember,
  useCharacterGroups,
  useCharacters,
  useCreateCharacterGroup,
  useDeleteCharacterGroup,
  useLorebooks,
  useRemoveGroupMember,
  useStartRoleplayFromGroup,
  useUpdateCharacterGroup,
} from "../lib/queries.ts";

/**
 * Character groups (SPEC §9, §20 phase 158).
 *
 * A roster of characters, optionally with the lorebook their roleplays open
 * into. The list here is the organisation half; "start roleplay" is the quick
 * creation half, turning a recurring cast into a scene in one tap.
 */

function MemberPills({ members }: { members: CharacterGroupDto["members"] }) {
  if (members.length === 0) return null;
  return (
    <p className="meta mt-[4px] truncate">
      {members.map((member) => member.name).join(", ")}
    </p>
  );
}

function GroupListSheet({
  onClose,
  onEdit,
}: {
  onClose(): void;
  onEdit(id: string): void;
}) {
  const groups = useCharacterGroups();
  const create = useCreateCharacterGroup();
  const remove = useDeleteCharacterGroup();
  const start = useStartRoleplayFromGroup();
  const [confirmNode, confirm] = useConfirm();

  const list = groups.data ?? [];

  return (
    <>
      <Sheet title={strings.characters.groups} meta={list.length === 0 ? undefined : String(list.length)} onClose={onClose}>
        <SheetAction
          label={strings.characters.groupsNew}
          onClick={() =>
            create.mutate(
              { name: strings.characters.groupsNewName },
              { onSuccess: (group) => onEdit(group.id) },
            )
          }
        />
        {list.length === 0 ? (
          <p className="explain pt-[12px] pb-[8px]">{strings.characters.groupsEmpty}</p>
        ) : (
          list.map((group) => (
            <div key={group.id} className="border-b border-rule py-[14px]">
              <div className="flex items-baseline gap-[10px]">
                <button
                  type="button"
                  onClick={() => onEdit(group.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[15px] font-medium">{group.name}</span>
                  <span className="meta mt-[3px] block truncate">
                    {[
                      strings.characters.groupsMembers(group.members.length),
                      group.lorebookName,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex-none"
                  disabled={start.isPending || group.members.length === 0}
                  onClick={() =>
                    start.mutate(group.id, {
                      onSuccess: (scene) => navigate({ name: "chat", sceneId: scene.id }),
                    })
                  }
                >
                  {strings.characters.groupsStart}
                </button>
              </div>
              <MemberPills members={group.members} />
              {group.members.length === 0 ? (
                <p className="explain mt-[6px]">{strings.characters.groupsNoMembers}</p>
              ) : null}
            </div>
          ))
        )}
      </Sheet>
      {confirmNode}
    </>
  );
}

function GroupEditorSheet({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose(): void;
}) {
  const groups = useCharacterGroups();
  const books = useLorebooks();
  const update = useUpdateCharacterGroup();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const remove = useDeleteCharacterGroup();
  const [confirmNode, confirm] = useConfirm();
  const [addOpen, setAddOpen] = useState(false);

  const group = (groups.data ?? []).find((candidate) => candidate.id === groupId);
  if (group === undefined) return null;

  const booksList = books.data ?? [];

  return (
    <>
      <Sheet
        title={strings.characters.groupsEdit}
        meta={group.name}
        onClose={onClose}
      >
        <label className="field-label mt-[4px]" htmlFor="group-name">
          {strings.characters.groupsName}
        </label>
        <input
          id="group-name"
          className="field mb-[10px]"
          defaultValue={group.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name !== "" && name !== group.name) update.mutate({ id: group.id, name });
          }}
        />

        <label className="field-label" htmlFor="group-lorebook">
          {strings.characters.groupsLorebook}
        </label>
        <select
          id="group-lorebook"
          className="field mb-[12px]"
          value={group.lorebookId ?? ""}
          onChange={(event) =>
            update.mutate({
              id: group.id,
              lorebookId: event.target.value === "" ? null : event.target.value,
            })
          }
        >
          <option value="">{strings.characters.groupsLorebookNone}</option>
          {booksList.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}
            </option>
          ))}
        </select>

        <p className="section-label mt-[6px]">{strings.characters.groupsMembersTitle}</p>
        {group.members.length === 0 ? (
          <p className="explain mt-[4px]">{strings.characters.groupsNoMembers}</p>
        ) : (
          group.members.map((member) => (
            <div
              key={member.characterId}
              className="flex items-center gap-[10px] border-b border-rule py-[10px]"
            >
              <span
                aria-hidden="true"
                className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-bg-raised bg-cover bg-center text-[13px] text-ink-dim"
                style={
                  member.hasAvatar
                    ? { backgroundImage: `url(/api/characters/${member.characterId}/avatar)` }
                    : undefined
                }
              >
                {member.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
              <button
                type="button"
                className="chrome text-[13px] text-ink-muted"
                onClick={() => removeMember.mutate({ id: group.id, characterId: member.characterId })}
              >
                {strings.characters.groupsRemove}
              </button>
            </div>
          ))
        )}

        <button type="button" className="btn mt-[12px] w-full" onClick={() => setAddOpen(true)}>
          {strings.characters.groupsAddCharacters}
        </button>

        <button
          type="button"
          className="chrome mt-[14px] w-full text-[14px]"
          style={{ color: "var(--onsen-color-red)" }}
          onClick={() =>
            confirm(
              strings.characters.groupsDeleteConfirm(group.name),
              () => {
                remove.mutate(group.id, { onSuccess: onClose });
              },
              { confirmLabel: strings.characters.groupsDelete },
            )
          }
        >
          {strings.characters.groupsDelete}
        </button>
      </Sheet>

      {addOpen ? (
        <CharacterPicker
          group={group}
          onClose={() => setAddOpen(false)}
          onAdd={(characterId) => addMember.mutate({ id: group.id, characterId })}
        />
      ) : null}
      {confirmNode}
    </>
  );
}

function CharacterPicker({
  group,
  onClose,
  onAdd,
}: {
  group: CharacterGroupDto;
  onClose(): void;
  onAdd(characterId: string): void;
}) {
  const characters = useCharacters({});
  const [q, setQ] = useState("");
  const all = characters.data ?? [];

  const already = useMemo(() => new Set(group.members.map((member) => member.characterId)), [group]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((character) => needle === "" || character.name.toLowerCase().includes(needle));
  }, [all, q]);

  return (
    <Sheet title={strings.characters.groupsAddCharacters} onClose={onClose}>
      <input
        className="field mb-[10px]"
        placeholder={strings.characters.groupsAddSearch}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        aria-label={strings.characters.groupsAddSearch}
      />
      {shown.map((character) => {
        const inGroup = already.has(character.id);
        return (
          <button
            key={character.id}
            type="button"
            disabled={inGroup}
            onClick={() => onAdd(character.id)}
            className="flex w-full items-center gap-[10px] border-b border-rule py-[11px] text-left disabled:opacity-40"
          >
            <span
              aria-hidden="true"
              className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-bg-raised bg-cover bg-center text-[13px] text-ink-dim"
              style={
                character.hasAvatar
                  ? { backgroundImage: `url(/api/characters/${character.id}/avatar)` }
                  : undefined
              }
            >
              {character.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px]">{character.name}</span>
            <span className="meta flex-none">{inGroup ? strings.characters.groupsInGroup : strings.characters.groupsAdd}</span>
          </button>
        );
      })}
    </Sheet>
  );
}

/** The entry point: a list, then the editor for whichever group is chosen. */
export function GroupsSheet({ onClose }: { onClose(): void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  if (editingId !== null) {
    return <GroupEditorSheet groupId={editingId} onClose={onClose} />;
  }
  return <GroupListSheet onClose={onClose} onEdit={setEditingId} />;
}
