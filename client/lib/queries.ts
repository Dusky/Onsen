import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { UpdateStatusDto } from "@shared/types.ts";
import type {
  AppendMessageRequest,
  AuthorDto,
  AutopilotStateDto,
  BulkCharacterRequest,
  BulkCharacterResponse,
  CharacterFilterQuery,
  CharacterSnapshotDto,
  CharacterVersionDto,
  ConnectionProfileDto,
  DocumentDto,
  EmbeddingsConfigDto,
  ExpressionPackDto,
  PromptInspectorDto,
  ApplyStage,
  RegexScriptDto,
  ScriptTestDto,
  EventTriggerDto,
  TriggerOutcomeDto,
  SavedFilterDto,
  TrackerDto,
  CreateConnectionProfileRequest,
  CreateProviderRequest,
  PresetDto,
  ProviderDto,
  RebuildGuidesRequest,
  SummaryStateDto,
  SceneOptionsDto,
  BanListDto,
  AddBanRequest,
  TaskDto,
  TaskRunDto,
  UpdateConnectionProfileRequest,
  UpdatePresetRequest,
  UpdateProviderRequest,
  UpdateTaskRequest,
  CharacterDto,
  PersonaDto,
  SceneSetupRequest,
  UpdateAuthorRequest,
  UpdatePersonaRequest,
  GuideDto,
  GuideKind,
  ImportCharacterResponse,
  UpdateCharacterRequest,
  MessageDto,
  SceneDto,
  SceneWithHistoryDto,
  SetActiveLeafRequest,
  DossierDto,
  DossierProposalDto,
  InstructTemplateDto,
  RecurringNameDto,
  LorebookDto,
  LorebookWithEntriesDto,
  LoreEntryDto,
  LoreActivationDto,
  LoreBindingScope,
  CreateLorebookRequest,
  UpdateLorebookRequest,
  UpdateLoreEntryRequest,
  ImportLorebookResponse,
  UpdateMessageRequest,
} from "@shared/types.ts";

/**
 * Server state, via TanStack Query (SPEC §1). Everything the chat screen shows
 * is server state — the message tree is authoritative and lives in SQLite, so
 * the client's job is to read it and invalidate, never to keep its own copy.
 */

export const keys = {
  scenes: ["scenes"] as const,
  scene: (id: string) => ["scenes", id] as const,
  siblings: (sceneId: string, messageId: string) =>
    ["scenes", sceneId, "messages", messageId, "siblings"] as const,
  autopilot: (sceneId: string) => ["scenes", sceneId, "autopilot"] as const,
  update: ["update"] as const,
};

/** The connection profiles, for anything that routes an operation (§6, §13). */
/**
 * The connection profiles, for anything that routes an operation (§6, §13).
 *
 * `enabled` is for the callers that only need the list once a sheet is open —
 * the chat screen's profile picker asks for it on a failure that most sessions
 * never hit, and fetching it on every scene open would be a request per
 * roleplay for a list nobody looked at.
 */
export function useConnectionProfiles(enabled = true) {
  return useQuery({
    queryKey: ["connection-profiles"] as const,
    queryFn: () => api.get<ConnectionProfileDto[]>("/connections/profiles"),
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Connections and per-op configuration (SPEC §7, §20 phase 13)        */
/* ------------------------------------------------------------------ */

export const connectionKeys = {
  providers: ["connection-providers"] as const,
  profiles: ["connection-profiles"] as const,
  presets: ["connection-presets"] as const,
  tasks: ["tasks"] as const,
  instruct: ["instruct-templates"] as const,
  scripts: ["regex-scripts"] as const,
  triggers: ["event-triggers"] as const,
  triggerActions: ["trigger-actions"] as const,
};

/** Invalidate everything a connection change can touch. */
function useConnectionMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: connectionKeys.providers });
      void client.invalidateQueries({ queryKey: connectionKeys.profiles });
      void client.invalidateQueries({ queryKey: connectionKeys.presets });
      // A deleted profile can null a scene's routing, so scenes are stale too.
      void client.invalidateQueries({ queryKey: keys.scenes });
    },
  });
}

/** The presets, which carry the samplers and the reasoning settings (§13). */
export function usePresets() {
  return useQuery({
    queryKey: connectionKeys.presets,
    queryFn: () => api.get<PresetDto[]>("/connections/presets"),
  });
}

export function useUpdatePreset() {
  return useConnectionMutation(({ id, ...patch }: UpdatePresetRequest & { id: string }) =>
    api.patch<PresetDto>(`/connections/presets/${id}`, patch),
  );
}

/** Import a SillyTavern chat-completion preset (SPEC §18, phase 28). */
export function useImportPreset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<{ presetName: string; blocksImported: number; blocksDisabled: number; unmappedSamplers: string[]; unsupportedMacros: string[] }> => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/connections/presets/import", { method: "POST", body: form });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = (body as { error?: { message?: string } })?.error;
        throw new Error(error?.message ?? "The preset could not be imported.");
      }
      return body as { presetName: string; blocksImported: number; blocksDisabled: number; unmappedSamplers: string[]; unsupportedMacros: string[] };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: connectionKeys.presets });
      void client.invalidateQueries({ queryKey: ["scenes"] });
    },
  });
}

export function useProviders() {
  return useQuery({
    queryKey: connectionKeys.providers,
    queryFn: () => api.get<ProviderDto[]>("/connections/providers"),
  });
}

export function useCreateProvider() {
  return useConnectionMutation((body: CreateProviderRequest) =>
    api.post<ProviderDto>("/connections/providers", body),
  );
}

export function useUpdateProvider() {
  return useConnectionMutation(({ id, ...body }: UpdateProviderRequest & { id: string }) =>
    api.patch<ProviderDto>(`/connections/providers/${id}`, body),
  );
}

/* ---------------- instruct templates (SPEC §4) ---------------- */

export function useInstructTemplates() {
  return useQuery({
    queryKey: connectionKeys.instruct,
    queryFn: () => api.get<InstructTemplateDto[]>("/connections/instruct-templates"),
  });
}

function useTemplateMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: connectionKeys.instruct });
      // Deleting a template clears the providers pointing at it, so their rows
      // are stale too.
      void client.invalidateQueries({ queryKey: connectionKeys.providers });
    },
  });
}

export function useCreateInstructTemplate() {
  return useTemplateMutation((body: { name: string; copyFrom?: string }) =>
    api.post<InstructTemplateDto>("/connections/instruct-templates", body),
  );
}

export function useUpdateInstructTemplate() {
  return useTemplateMutation(({ id, ...patch }: Partial<InstructTemplateDto> & { id: string }) =>
    api.patch<InstructTemplateDto>(`/connections/instruct-templates/${id}`, patch),
  );
}

export function useDeleteInstructTemplate() {
  return useTemplateMutation((id: string) =>
    api.delete<void>(`/connections/instruct-templates/${id}`),
  );
}

export function useDeleteProvider() {
  return useConnectionMutation((id: string) =>
    api.delete<ProviderDto[]>(`/connections/providers/${id}`),
  );
}

export function useCreateProfile() {
  return useConnectionMutation((body: CreateConnectionProfileRequest) =>
    api.post<ConnectionProfileDto>("/connections/profiles", body),
  );
}

export function useUpdateProfile() {
  return useConnectionMutation(
    ({ id, ...body }: UpdateConnectionProfileRequest & { id: string }) =>
      api.patch<ConnectionProfileDto>(`/connections/profiles/${id}`, body),
  );
}

export function useDeleteProfile() {
  return useConnectionMutation((id: string) =>
    api.delete<ConnectionProfileDto[]>(`/connections/profiles/${id}`),
  );
}

/** Every op's configuration row (SPEC §7). */
export function useTasks() {
  return useQuery({
    queryKey: connectionKeys.tasks,
    queryFn: () => api.get<TaskDto[]>("/tasks"),
  });
}

export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }: UpdateTaskRequest & { key: string }) =>
      api.patch<TaskDto>(`/tasks/${key}`, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: connectionKeys.tasks }),
  });
}

/**
 * What a background task has actually been doing (SPEC §7).
 *
 * A side call may never fail a generation, so its failures are swallowed by
 * design — this is where they can still be read. Refetched rather than cached
 * for long: the interesting case is "it just went wrong".
 */
export function useTaskRuns(key: string, enabled: boolean) {
  return useQuery({
    queryKey: ["tasks", key, "runs"] as const,
    queryFn: () => api.get<TaskRunDto[]>(`/tasks/${key}/runs`),
    enabled,
    staleTime: 0,
  });
}

export function useScenes() {
  return useQuery({ queryKey: keys.scenes, queryFn: () => api.get<SceneDto[]>("/scenes") });
}

export function useScene(sceneId: string) {
  return useQuery({
    queryKey: keys.scene(sceneId),
    queryFn: () => api.get<SceneWithHistoryDto>(`/scenes/${sceneId}`),
    /**
     * The post-generation passes run behind the turn rather than delaying it
     * (SPEC §7.5), so their notes arrive after the message does. Polling while
     * any message says it is still being read is the smallest thing that works;
     * it stops on its own, and a per-scene channel (§5) would close the seam
     * properly when multi-device sync arrives.
     */
    refetchInterval: (query) =>
      (query.state.data?.messages ?? []).some((message) => message.passesPending) ? 1200 : false,
  });
}

export function useSiblings(sceneId: string, messageId: string | null) {
  return useQuery({
    queryKey: keys.siblings(sceneId, messageId ?? ""),
    queryFn: () =>
      api.get<MessageDto[]>(`/scenes/${sceneId}/messages/${messageId}/siblings`),
    enabled: messageId !== null,
  });
}

export function useCreateScene() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; connectionProfileId?: string | null }) =>
      api.post<SceneDto>("/scenes", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.scenes }),
  });
}

/** Everything that changes a scene's tree invalidates that scene and the list. */
function useSceneMutation<TArgs, TResult>(
  sceneId: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scenes });
    },
  });
}

export function useSendMessage(sceneId: string) {
  return useSceneMutation(sceneId, (body: AppendMessageRequest) =>
    api.post<MessageDto>(`/scenes/${sceneId}/messages`, body),
  );
}

export function useEditMessage(sceneId: string) {
  return useSceneMutation(
    sceneId,
    ({ messageId, ...patch }: UpdateMessageRequest & { messageId: string }) =>
      api.patch<MessageDto>(`/scenes/${sceneId}/messages/${messageId}`, patch),
  );
}

export function useDeleteMessage(sceneId: string) {
  return useSceneMutation(sceneId, (messageId: string) =>
    api.delete<SceneDto>(`/scenes/${sceneId}/messages/${messageId}`),
  );
}

/**
 * Split a beat into one message per part (SPEC §7). The beat itself is kept as
 * a sibling of the first of them, so this branches rather than converts.
 */
export function useSplitBeat(sceneId: string) {
  return useSceneMutation(sceneId, (messageId: string) =>
    api.post<SceneWithHistoryDto>(`/scenes/${sceneId}/messages/${messageId}/split`, {}),
  );
}

/** Read a finished turn back and leave notes on it (SPEC §7.5). */
export function useRunPasses(sceneId: string) {
  return useSceneMutation(sceneId, (messageId: string) =>
    api.post<MessageDto>(`/scenes/${sceneId}/messages/${messageId}/passes`, {}),
  );
}

/* ------------------------------------------------------------------ */
/* Persistent guides (SPEC §8)                                         */
/* ------------------------------------------------------------------ */

/**
 * Guides are read off the scene rather than a list of their own: they are
 * versioned per message and the set in force follows the active path, so
 * re-reading the scene is the only honest way to know what is being injected.
 * Every one of these returns the new set, and every one invalidates the scene.
 */

/** Write or rewrite one guide, or every guide that is switched on (§8). */
export function useRebuildGuides(sceneId: string) {
  return useSceneMutation(sceneId, (body: RebuildGuidesRequest) =>
    api.post<GuideDto[]>(`/scenes/${sceneId}/guides/rebuild`, body),
  );
}

/** Hand-edit a guide, which pins it against the next refresh (§8). */
export function useEditGuide(sceneId: string) {
  return useSceneMutation(sceneId, ({ guideId, content }: { guideId: string; content: string }) =>
    api.patch<GuideDto>(`/scenes/${sceneId}/guides/${guideId}`, { content }),
  );
}

/** Stop injecting one guide, or all of them. Every version goes (§8). */
export function useFlushGuides(sceneId: string) {
  return useSceneMutation(sceneId, (kind: GuideKind | "all") =>
    api.delete<GuideDto[]>(`/scenes/${sceneId}/guides/${kind}`),
  );
}

/* ------------------------------------------------------------------ */
/* Prompt options and the ban list (SPEC §13.5, §13.6)                 */
/* ------------------------------------------------------------------ */

export const optionKeys = {
  options: (sceneId: string) => ["scenes", sceneId, "options"] as const,
  bans: (sceneId: string) => ["scenes", sceneId, "bans"] as const,
};

export function useSceneOptions(sceneId: string) {
  return useQuery({
    queryKey: optionKeys.options(sceneId),
    queryFn: () => api.get<SceneOptionsDto>(`/scenes/${sceneId}/options`),
  });
}

/** Every option mutation returns the whole state, so they all invalidate it. */
function useOptionMutation<TArgs>(sceneId: string, fn: (args: TArgs) => Promise<SceneOptionsDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: optionKeys.options(sceneId) });
      // What the prompt carries changed, so the scene's costs moved with it.
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  });
}

/** Switch one option on or off. Cardinality is settled server-side (§13.5). */
export function useSetOption(sceneId: string) {
  return useOptionMutation(sceneId, ({ optionId, on }: { optionId: string; on: boolean }) =>
    api.put<SceneOptionsDto>(`/scenes/${sceneId}/options/${optionId}`, { on }),
  );
}

/** Back to the shipped configuration, which is not the same as all off (§22). */
export function useResetOptions(sceneId: string) {
  return useOptionMutation(sceneId, () =>
    api.delete<SceneOptionsDto>(`/scenes/${sceneId}/options`),
  );
}

export function useBans(sceneId: string, enabled: boolean) {
  return useQuery({
    queryKey: optionKeys.bans(sceneId),
    queryFn: () => api.get<BanListDto>(`/scenes/${sceneId}/bans`),
    enabled,
  });
}

function useBanMutation<TArgs>(sceneId: string, fn: (args: TArgs) => Promise<BanListDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: optionKeys.bans(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  });
}

export function useAddBan(sceneId: string) {
  return useBanMutation(sceneId, (body: AddBanRequest) =>
    api.post<BanListDto>(`/scenes/${sceneId}/bans`, body),
  );
}

/** Ask what this scene keeps reaching for. Proposals, not bans (§13.6). */
export function useAnalyseBans(sceneId: string) {
  return useBanMutation(sceneId, () =>
    api.post<BanListDto & { detail: string | null }>(`/scenes/${sceneId}/bans/analyse`, {}),
  );
}

export function useUpdateBan(sceneId: string) {
  return useBanMutation(
    sceneId,
    ({ banId, ...patch }: { banId: string; accept?: boolean; enabled?: boolean }) =>
      api.patch<BanListDto>(`/scenes/${sceneId}/bans/${banId}`, patch),
  );
}

export function useDeleteBan(sceneId: string) {
  return useBanMutation(sceneId, (banId: string) =>
    api.delete<BanListDto>(`/scenes/${sceneId}/bans/${banId}`),
  );
}

/* ------------------------------------------------------------------ */
/* Rolling summarisation (SPEC §11)                                    */
/* ------------------------------------------------------------------ */

/**
 * Unlike the guides, the summaries are their own query rather than part of the
 * scene: the panel is the only thing that reads them, they carry a pending
 * count that changes on every turn, and putting that on the scene response
 * would make every message send re-serialise the lot.
 */
export const summaryKeys = {
  all: (sceneId: string) => ["scenes", sceneId, "summaries"] as const,
};

export function useSummaries(sceneId: string, enabled: boolean) {
  return useQuery({
    queryKey: summaryKeys.all(sceneId),
    queryFn: () => api.get<SummaryStateDto>(`/scenes/${sceneId}/summaries`),
    enabled,
  });
}

/** Every summary mutation returns the whole state, so they all invalidate it. */
function useSummaryMutation<TArgs>(sceneId: string, fn: (args: TArgs) => Promise<SummaryStateDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: summaryKeys.all(sceneId) });
      // Eviction changes what the prompt carries, so the scene's own costs move.
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  });
}

/** Summarise now rather than waiting for a threshold (§11). */
export function useSummariseNow(sceneId: string) {
  return useSummaryMutation(sceneId, () =>
    api.post<SummaryStateDto>(`/scenes/${sceneId}/summaries`, {}),
  );
}

/** Write one again over the same range. An edited one is overwritten: they asked. */
export function useRewriteSummary(sceneId: string) {
  return useSummaryMutation(sceneId, (summaryId: string) =>
    api.post<SummaryStateDto>(`/scenes/${sceneId}/summaries/${summaryId}/rewrite`, {}),
  );
}

/** Hand-edit a summary, which marks it against regeneration (§11). */
export function useEditSummary(sceneId: string) {
  return useSummaryMutation(
    sceneId,
    ({ summaryId, content }: { summaryId: string; content: string }) =>
      api.patch<SummaryStateDto>(`/scenes/${sceneId}/summaries/${summaryId}`, { content }),
  );
}

/** Forget one, or all. The messages become pending again, not lost (§11). */
export function useForgetSummary(sceneId: string) {
  return useSummaryMutation(sceneId, (summaryId: string) =>
    api.delete<SummaryStateDto>(`/scenes/${sceneId}/summaries/${summaryId}`),
  );
}

/** Put back what a pass changed. The original is always retained (§7.5). */
export function useRevertAnnotation(sceneId: string) {
  return useSceneMutation(sceneId, (annotationId: string) =>
    api.post<MessageDto>(`/scenes/${sceneId}/annotations/${annotationId}/revert`, {}),
  );
}

/** Swipe, rewind, branch and checkpoint restore are all this one call (§2). */
export function useSetLeaf(sceneId: string) {
  return useSceneMutation(sceneId, (body: SetActiveLeafRequest) =>
    api.put<SceneWithHistoryDto>(`/scenes/${sceneId}/leaf`, body),
  );
}

/* ------------------------------------------------------------------ */
/* Characters (SPEC §9)                                                */
/* ------------------------------------------------------------------ */

export const characterKeys = {
  all: ["characters"] as const,
  one: (id: string) => ["characters", id] as const,
  tags: ["characters", "tags"] as const,
  folders: ["characters", "folders"] as const,
  versions: (id: string) => ["characters", id, "versions"] as const,
  snapshot: (id: string, versionId: string) => ["characters", id, "versions", versionId] as const,
};

/** The library, searched and filtered server-side (SPEC §9, phase 26). */
export function useCharacters(filter: CharacterFilterQuery = {}) {
  return useQuery({
    queryKey: ["characters", filter] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const key of ["q", "tag", "folder"] as const) {
        const value = filter[key];
        if (value !== undefined && value !== "") params.set(key, value);
      }
      const qs = params.toString();
      return api.get<CharacterDto[]>(qs === "" ? "/characters" : `/characters?${qs}`);
    },
  });
}

export function useCharacter(id: string) {
  return useQuery({
    queryKey: characterKeys.one(id),
    queryFn: () => api.get<CharacterDto>(`/characters/${id}`),
  });
}

/** Import goes through fetch directly: it is multipart, not JSON. */
export function useImportCharacter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ImportCharacterResponse> => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/characters/import", { method: "POST", body: form });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? "That card could not be read.",
        );
      }
      return body as ImportCharacterResponse;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: characterKeys.all }),
  });
}

export function useCreateCharacter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) => api.post<CharacterDto>("/characters", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: characterKeys.all }),
  });
}

export function useUpdateCharacter(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCharacterRequest) =>
      api.patch<CharacterDto>(`/characters/${id}`, patch),
    onSuccess: (character) => {
      client.setQueryData(characterKeys.one(id), character);
      void client.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useDeleteCharacter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/characters/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: characterKeys.all }),
  });
}

/* ------------------------------------------------------------------ */
/* Authors, personas and cast (SPEC §2, §20 phase 7)                   */
/* ------------------------------------------------------------------ */

export const authorKeys = {
  all: ["authors"] as const,
  one: (id: string) => ["authors", id] as const,
  personas: ["personas"] as const,
};

export function useAuthors() {
  return useQuery({ queryKey: authorKeys.all, queryFn: () => api.get<AuthorDto[]>("/authors") });
}

export function useAuthor(id: string) {
  return useQuery({
    queryKey: authorKeys.one(id),
    queryFn: () => api.get<AuthorDto>(`/authors/${id}`),
  });
}

export function useCreateAuthor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) => api.post<AuthorDto>("/authors", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: authorKeys.all }),
  });
}

export function useUpdateAuthor(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAuthorRequest) => api.patch<AuthorDto>(`/authors/${id}`, patch),
    onSuccess: (author) => {
      client.setQueryData(authorKeys.one(id), author);
      void client.invalidateQueries({ queryKey: authorKeys.all });
    },
  });
}

export function useDeleteAuthor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/authors/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: authorKeys.all }),
  });
}

export function usePersonas() {
  return useQuery({
    queryKey: authorKeys.personas,
    queryFn: () => api.get<PersonaDto[]>("/personas"),
  });
}

export function useCreatePersona() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) => api.post<PersonaDto>("/personas", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: authorKeys.personas }),
  });
}

export function useUpdatePersona(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatePersonaRequest) => api.patch<PersonaDto>(`/personas/${id}`, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: authorKeys.personas }),
  });
}

/** Author, persona, preset and profile all live on the scene itself. */
export function useSceneSetup(sceneId: string) {
  return useSceneMutation(sceneId, (body: SceneSetupRequest) =>
    api.patch<SceneDto>(`/scenes/${sceneId}`, body),
  );
}

export function useAddToCast(sceneId: string) {
  return useSceneMutation(sceneId, (characterId: string) =>
    api.put<SceneDto>(`/scenes/${sceneId}/cast/${characterId}`),
  );
}

export function useRemoveFromCast(sceneId: string) {
  return useSceneMutation(sceneId, (characterId: string) =>
    api.delete<SceneDto>(`/scenes/${sceneId}/cast/${characterId}`),
  );
}

/** Cue a character for the next turn. Client-side: the cue is not persisted. */
export function useBenchMember(sceneId: string) {
  return useSceneMutation(
    sceneId,
    ({ characterId, isActive }: { characterId: string; isActive: boolean }) =>
      api.patch<SceneDto>(`/scenes/${sceneId}/cast/${characterId}`, { isActive }),
  );
}

/* ------------------------------------------------------------------ */
/* Lorebooks (SPEC §10, §20 phase 21)                                  */
/* ------------------------------------------------------------------ */

export const loreKeys = {
  all: ["lorebooks"] as const,
  one: (id: string) => ["lorebooks", id] as const,
  activation: (sceneId: string) => ["scenes", sceneId, "lore"] as const,
};

export function useLorebooks() {
  return useQuery({
    queryKey: loreKeys.all,
    queryFn: () => api.get<LorebookDto[]>("/lorebooks"),
  });
}

export function useLorebook(id: string) {
  return useQuery({
    queryKey: loreKeys.one(id),
    queryFn: () => api.get<LorebookWithEntriesDto>(`/lorebooks/${id}`),
  });
}

export function useCreateLorebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLorebookRequest) => api.post<LorebookDto>("/lorebooks", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.all }),
  });
}

/** Import is multipart, like a character card, so it goes through fetch. */
export function useImportLorebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ImportLorebookResponse> => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/lorebooks/import", { method: "POST", body: form });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ??
            "That world info file could not be read.",
        );
      }
      return body as ImportLorebookResponse;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.all }),
  });
}

export function useUpdateLorebook(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateLorebookRequest) => api.patch<LorebookDto>(`/lorebooks/${id}`, patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: loreKeys.one(id) });
      void client.invalidateQueries({ queryKey: loreKeys.all });
    },
  });
}

export function useDeleteLorebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/lorebooks/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.all }),
  });
}

export function useCreateLoreEntry(bookId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LoreEntryDto>(`/lorebooks/${bookId}/entries`, {}),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.one(bookId) }),
  });
}

export function useUpdateLoreEntry(bookId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, ...patch }: UpdateLoreEntryRequest & { entryId: string }) =>
      api.patch<LoreEntryDto>(`/lorebooks/${bookId}/entries/${entryId}`, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.one(bookId) }),
  });
}

export function useDeleteLoreEntry(bookId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      api.delete<void>(`/lorebooks/${bookId}/entries/${entryId}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.one(bookId) }),
  });
}

export function useBindLorebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bookId, ...body }: { bookId: string; scope: LoreBindingScope; targetId?: string }) =>
      api.post<LorebookDto>(`/lorebooks/${bookId}/bindings`, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.all }),
  });
}

export function useUnbindLorebook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bookId, bindingId }: { bookId: string; bindingId: string }) =>
      api.delete<LorebookDto>(`/lorebooks/${bookId}/bindings/${bindingId}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: loreKeys.all }),
  });
}

/**
 * §16's activation test tool: what would fire for this scene right now, and
 * what would not. Only fetched with the sheet open, and never cached long —
 * every message the scene gains changes the answer.
 */
export function useLoreActivation(sceneId: string, enabled: boolean) {
  return useQuery({
    queryKey: loreKeys.activation(sceneId),
    queryFn: () => api.get<LoreActivationDto[]>(`/scenes/${sceneId}/lore`),
    staleTime: 0,
    enabled,
  });
}

/* ---------------- self-update (SPEC §17) ---------------- */

/**
 * Where the running code stands against its remote.
 *
 * The GET behind this is local facts only — no network — so it is cheap enough
 * to ask on every settings screen load. The interesting half (behind by how
 * much) is null until a check runs, which is its own button, not this hook.
 */
export function useUpdateStatus() {
  return useQuery({
    queryKey: keys.update,
    queryFn: () => api.get<UpdateStatusDto>("/system/update"),
  });
}

/** Fetch the remote, then report against it. */
export function useCheckUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpdateStatusDto>("/system/update/check"),
    onSuccess: (status) => void client.setQueryData(keys.update, status),
  });
}

/** Pull and rebuild. A refusal arrives as a thrown 409 with the reason. */
export function useApplyUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpdateStatusDto>("/system/update/apply"),
    onSuccess: (status) => void client.setQueryData(keys.update, status),
  });
}

/* ---------------- autopilot (SPEC §6) ---------------- */

/**
 * Where the scene's autopilot stands. Refetched whenever a generation settles
 * and whenever the scene is, because the loop outlives any one generation the
 * client watched — the row is how the screen learns another turn is coming.
 */
export function useAutopilot(sceneId: string) {
  return useQuery({
    queryKey: keys.autopilot(sceneId),
    queryFn: () => api.get<AutopilotStateDto>(`/scenes/${sceneId}/autopilot`),
  });
}

/** §6's prominent stop. Cancels the turn in flight and ends the loop. */
export function useStopAutopilot(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AutopilotStateDto>(`/scenes/${sceneId}/autopilot/stop`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.autopilot(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  });
}

/* ---------------- the prompt inspector (SPEC §16, phase 25) ---------------- */

/**
 * The exact prompt behind a message. Fetched when the sheet is open and never
 * cached long — the next generation is a different prompt, and a stale answer
 * to "what did the model see" is worse than none.
 */
export function useInspector(sceneId: string, messageId: string | null) {
  return useQuery({
    queryKey: ["scenes", sceneId, "inspector", messageId] as const,
    queryFn: () => api.get<PromptInspectorDto>(`/scenes/${sceneId}/inspector/${messageId}`),
    enabled: messageId !== null,
    staleTime: 0,
  });
}

/** The scene's own settings — the director bar's autopilot switch lives here. */
export function useUpdateScene(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<unknown>(`/scenes/${sceneId}`, patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
      void client.invalidateQueries({ queryKey: keys.scenes });
    },
  });
}

/* ---------------- the library at scale (SPEC §9, phase 26) ---------------- */

export function useCharacterTags() {
  return useQuery({
    queryKey: characterKeys.tags,
    queryFn: () => api.get<string[]>("/characters/tags"),
  });
}

export function useCharacterFolders() {
  return useQuery({
    queryKey: characterKeys.folders,
    queryFn: () => api.get<string[]>("/characters/folders"),
  });
}

export function useBulkCharacters() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCharacterRequest) => api.post<BulkCharacterResponse>("/characters/bulk", body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: characterKeys.all });
      void client.invalidateQueries({ queryKey: characterKeys.tags });
      void client.invalidateQueries({ queryKey: characterKeys.folders });
    },
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: ["filters"] as const,
    queryFn: () => api.get<SavedFilterDto[]>("/filters"),
  });
}

export function useCreateFilter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; query: CharacterFilterQuery }) =>
      api.post<SavedFilterDto>("/filters", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useDeleteFilter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/filters/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useCharacterVersions(characterId: string) {
  return useQuery({
    queryKey: characterKeys.versions(characterId),
    queryFn: () => api.get<CharacterVersionDto[]>(`/characters/${characterId}/versions`),
  });
}

export function useCharacterSnapshot(characterId: string, versionId: string | null) {
  return useQuery({
    queryKey: characterKeys.snapshot(characterId, versionId ?? ""),
    queryFn: () => api.get<CharacterSnapshotDto>(`/characters/${characterId}/versions/${versionId}`),
    enabled: versionId !== null,
  });
}

export function useRestoreVersion(characterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post<CharacterDto>(`/characters/${characterId}/versions/${versionId}/restore`),
    onSuccess: (character) => {
      client.setQueryData(characterKeys.one(characterId), character);
      void client.invalidateQueries({ queryKey: characterKeys.all });
      void client.invalidateQueries({ queryKey: characterKeys.versions(characterId) });
    },
  });
}

export function useDeriveCharacter(characterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) =>
      api.post<CharacterDto>(`/characters/${characterId}/derive`, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: characterKeys.all }),
  });
}

export function useSuggestTags(characterId: string) {
  return useMutation({
    mutationFn: () => api.post<{ tags: string[] }>(`/characters/${characterId}/suggest-tags`),
  });
}

/* ---------------- AI-assisted authoring (SPEC §9, phase 27) ---------------- */

export function useAuthorCreate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { description: string; sceneId?: string }) =>
      api.post<CharacterDto>("/authoring/characters", body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: characterKeys.all });
      void client.invalidateQueries({ queryKey: characterKeys.tags });
    },
  });
}

export function useAuthorRevise(characterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (instructions: string) =>
      api.post<CharacterDto>(`/authoring/characters/${characterId}/revise`, { instructions }),
    onSuccess: (character) => {
      client.setQueryData(characterKeys.one(characterId), character);
      void client.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useAuthorVoice(characterId: string) {
  return useMutation({
    mutationFn: () => api.post<{ voiceNotes: string }>(`/authoring/characters/${characterId}/voice-notes`),
  });
}

export function useAuthorExtract(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) =>
      api.post<CharacterDto>(`/authoring/scenes/${sceneId}/extract-character`, { name }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: characterKeys.all });
    },
  });
}

export function useAuthorSuggestLore(sceneId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ entries: { title: string; content: string; keys: string[] }[] }>(
        `/authoring/scenes/${sceneId}/suggest-lore`,
      ),
  });
}

/* ---------------- character dossiers (SPEC §11, phase 32) ---------------- */

export const dossierKeys = {
  scene: (sceneId: string) => ["dossiers", sceneId] as const,
  recurring: (sceneId: string) => ["dossiers", sceneId, "recurring"] as const,
};

export function useDossiers(sceneId: string) {
  return useQuery({
    queryKey: dossierKeys.scene(sceneId),
    queryFn: () => api.get<DossierDto[]>(`/dossiers/scenes/${sceneId}`),
  });
}

/**
 * Names the scene keeps returning to that have no sheet yet.
 *
 * Never stale: every turn changes the answer, and an offer to write a dossier
 * for someone who was named three messages ago is the whole feature.
 */
export function useRecurringNames(sceneId: string, enabled: boolean) {
  return useQuery({
    queryKey: dossierKeys.recurring(sceneId),
    queryFn: () => api.get<{ names: RecurringNameDto[] }>(`/authoring/scenes/${sceneId}/recurring`),
    staleTime: 0,
    enabled,
  });
}

/** Ask the model to write one. A proposal, not a row — the reader accepts it. */
export function useWriteDossier(sceneId: string) {
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ dossier: DossierProposalDto }>(`/authoring/scenes/${sceneId}/dossier`, { name }),
  });
}

function useDossierMutation<TArgs, TResult>(sceneId: string, fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: dossierKeys.scene(sceneId) });
      // Accepting one removes it from the offers, and promoting one adds a card.
      void client.invalidateQueries({ queryKey: dossierKeys.recurring(sceneId) });
      void client.invalidateQueries({ queryKey: characterKeys.all });
      // The dossier renders into a lore entry, so the books changed too.
      void client.invalidateQueries({ queryKey: loreKeys.all });
    },
  });
}

export function useSaveDossier(sceneId: string) {
  return useDossierMutation(sceneId, (body: DossierProposalDto & { mentions?: number }) =>
    api.post<DossierDto>(`/dossiers/scenes/${sceneId}`, body),
  );
}

export function useUpdateDossier(sceneId: string) {
  return useDossierMutation(
    sceneId,
    ({ id, ...patch }: Partial<DossierProposalDto> & { id: string }) =>
      api.patch<DossierDto>(`/dossiers/${id}`, patch),
  );
}

export function useDeleteDossier(sceneId: string) {
  return useDossierMutation(sceneId, (id: string) => api.delete<void>(`/dossiers/${id}`));
}

export function usePromoteDossier(sceneId: string) {
  return useDossierMutation(sceneId, (id: string) =>
    api.post<{ character: CharacterDto; dossier: DossierDto }>(`/dossiers/${id}/promote`),
  );
}

/* ---------------- expressions and VN staging (SPEC §12, phase 29) ---------------- */

export function useExpressionPack(characterId: string) {
  return useQuery({
    queryKey: ["characters", characterId, "expressions"] as const,
    queryFn: () => api.get<ExpressionPackDto>(`/characters/${characterId}/expressions`),
  });
}

export function useUploadExpression(characterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, file }: { label: string; file: File }) => {
      const form = new FormData();
      form.append("label", label);
      form.append("file", file);
      const response = await fetch(`/api/characters/${characterId}/expressions`, {
        method: "POST",
        body: form,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = (body as { error?: { message?: string } })?.error;
        throw new Error(error?.message ?? "The sprite could not be uploaded.");
      }
      return body as ExpressionPackDto;
    },
    onSuccess: (pack) =>
      void client.invalidateQueries({ queryKey: ["characters", characterId, "expressions"] }),
  });
}

export function useDeleteExpression(characterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (expressionId: string) =>
      api.delete<void>(`/characters/expressions/${expressionId}`),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["characters", characterId, "expressions"] }),
  });
}

export function useSetSceneBackground(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/scenes/${sceneId}/background`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("The background could not be uploaded.");
      return (await response.json()) as SceneDto;
    },
    onSuccess: (scene) => {
      void client.invalidateQueries({ queryKey: keys.scene(sceneId) });
    },
  });
}

/* ---------------- the data bank (SPEC §11, phase 30) ---------------- */

export function useEmbeddingsConfig() {
  return useQuery({
    queryKey: ["embeddings"] as const,
    queryFn: () => api.get<EmbeddingsConfigDto>("/connections/embeddings"),
  });
}

export function useSaveEmbeddingsConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { baseUrl?: string | null; model?: string | null; apiKey?: string | null }) =>
      api.put<EmbeddingsConfigDto>("/connections/embeddings", body),
    onSuccess: (config) => client.setQueryData(["embeddings"], config),
  });
}

export function useDocuments(sceneId: string | null) {
  return useQuery({
    queryKey: ["documents", sceneId] as const,
    queryFn: () =>
      api.get<DocumentDto[]>(sceneId === null ? "/documents" : `/documents?sceneId=${sceneId}`),
  });
}

export function useIngestDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; text: string; sceneId?: string | null }) =>
      api.post<DocumentDto>("/documents", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/documents/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["documents"] }),
  });
}

/* ---------------- structured trackers (SPEC §8, phase 31) ---------------- */

export function useTrackers(sceneId: string) {
  return useQuery({
    queryKey: ["scenes", sceneId, "trackers"] as const,
    queryFn: () => api.get<TrackerDto[]>(`/scenes/${sceneId}/trackers`),
  });
}

export function useEditTracker(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch<TrackerDto>(`/scenes/${sceneId}/trackers/${id}`, { content }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["scenes", sceneId, "trackers"] }),
  });
}

export function useFlushTrackers(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (kind: "scene" | "characters" | "all") =>
      api.delete<TrackerDto[]>(`/scenes/${sceneId}/trackers/${kind}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["scenes", sceneId, "trackers"] }),
  });
}

export function useRebuildTrackers(sceneId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<TrackerDto[]>(`/scenes/${sceneId}/trackers/rebuild`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["scenes", sceneId, "trackers"] }),
  });
}

/** §16's provider test button: one round trip, reported with its latency. */
export function useTestProvider(providerId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; latencyMs: number; detail: string | null }>(
        `/connections/providers/${providerId}/test`,
      ),
  });
}

/** Revise one lore entry against what has happened since (SPEC §9, phase 27). */
export function useReviseLore(entryId: string) {
  return useMutation({
    mutationFn: (body?: { sceneId?: string }) => api.post<LoreEntryDto>(`/authoring/lore/${entryId}/revise`, body),
  });
}

/** Seed the demo cast, scene, and the author's user guide (first run). */
export function useSeedDemo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sceneId: string; charactersCreated: number; guideAdded: boolean }>("/demo/seed"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: characterKeys.all });
      void client.invalidateQueries({ queryKey: ["scenes"] });
      void client.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

/** Pull a provider's model list from its own API (SPEC §16). */
export function useFetchModels() {
  return useMutation({
    mutationFn: (body: { kind?: string; baseUrl: string; apiKey?: string; providerId?: string }) =>
      api.post<{ models: string[] }>("/connections/providers/models", body),
  });
}

/* ------------------------------------------------------------------ */
/* Regex scripts and event triggers (SPEC §14)                         */
/* ------------------------------------------------------------------ */

export function useScripts() {
  return useQuery({
    queryKey: connectionKeys.scripts,
    queryFn: () => api.get<RegexScriptDto[]>("/scripts"),
  });
}

/**
 * Every script mutation invalidates the triggers too: a trigger names a script
 * by id, and deleting one leaves the other pointing at nothing.
 */
function useScriptMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: connectionKeys.scripts });
      void client.invalidateQueries({ queryKey: connectionKeys.triggers });
      void client.invalidateQueries({ queryKey: connectionKeys.triggerActions });
      // A stored script can rewrite what the log shows, so the open scene is
      // stale the moment one changes.
      void client.invalidateQueries({ queryKey: keys.scenes });
    },
  });
}

export function useCreateScript() {
  return useScriptMutation((body: Partial<RegexScriptDto>) =>
    api.post<RegexScriptDto>("/scripts", body),
  );
}

export function useUpdateScript() {
  return useScriptMutation(({ id, ...body }: Partial<RegexScriptDto> & { id: string }) =>
    api.patch<RegexScriptDto>(`/scripts/${id}`, body),
  );
}

export function useDeleteScript() {
  return useScriptMutation((id: string) => api.delete<void>(`/scripts/${id}`));
}

/** The test panel (§14). A dry run: it writes nothing, so it invalidates nothing. */
export function useTestScripts() {
  return useMutation({
    mutationFn: (body: {
      applyTo: ApplyStage;
      text: string;
      sceneId?: string;
      /** The unsaved script. Without it, the saved chain for the stage runs. */
      draft?: { name: string; pattern: string; replacement: string; flags: string };
    }) => api.post<ScriptTestDto>("/scripts/test", body),
  });
}

export function useTriggers() {
  return useQuery({
    queryKey: connectionKeys.triggers,
    queryFn: () => api.get<EventTriggerDto[]>("/triggers"),
  });
}

/** What an action may point at, so the editor never offers a dead reference. */
export function useTriggerActions() {
  return useQuery({
    queryKey: connectionKeys.triggerActions,
    queryFn: () =>
      api.get<{
        events: string[];
        guide: { value: string; label: string }[];
        tracker: { value: string; label: string }[];
        script: { value: string; label: string }[];
      }>("/triggers/actions"),
  });
}

function useTriggerMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: connectionKeys.triggers }),
  });
}

export function useCreateTrigger() {
  return useTriggerMutation((body: Record<string, unknown>) =>
    api.post<EventTriggerDto>("/triggers", body),
  );
}

export function useUpdateTrigger() {
  return useTriggerMutation(({ id, ...body }: Record<string, unknown> & { id: string }) =>
    api.patch<EventTriggerDto>(`/triggers/${id}`, body),
  );
}

export function useDeleteTrigger() {
  return useTriggerMutation((id: string) => api.delete<void>(`/triggers/${id}`));
}

/**
 * Fire one by hand against a named roleplay. Not a dry run — a guide refresh
 * has nowhere to happen but the scene — so everything a trigger can touch is
 * stale afterwards.
 */
export function useRunTrigger() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sceneId }: { id: string; sceneId: string }) =>
      api.post<TriggerOutcomeDto>(`/triggers/${id}/run`, { sceneId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.scenes }),
  });
}
