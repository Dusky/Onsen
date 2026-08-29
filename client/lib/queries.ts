import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type {
  AppendMessageRequest,
  AuthorDto,
  ConnectionProfileDto,
  CreateConnectionProfileRequest,
  CreateProviderRequest,
  ProviderDto,
  RebuildGuidesRequest,
  TaskDto,
  TaskRunDto,
  UpdateConnectionProfileRequest,
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
};

/** The connection profiles, for anything that routes an operation (§6, §13). */
export function useConnectionProfiles() {
  return useQuery({
    queryKey: ["connection-profiles"] as const,
    queryFn: () => api.get<ConnectionProfileDto[]>("/connections/profiles"),
  });
}

/* ------------------------------------------------------------------ */
/* Connections and per-op configuration (SPEC §7, §20 phase 13)        */
/* ------------------------------------------------------------------ */

export const connectionKeys = {
  providers: ["connection-providers"] as const,
  profiles: ["connection-profiles"] as const,
  tasks: ["tasks"] as const,
};

/** Invalidate everything a connection change can touch. */
function useConnectionMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: connectionKeys.providers });
      void client.invalidateQueries({ queryKey: connectionKeys.profiles });
      // A deleted profile can null a scene's routing, so scenes are stale too.
      void client.invalidateQueries({ queryKey: keys.scenes });
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
};

export function useCharacters() {
  return useQuery({
    queryKey: characterKeys.all,
    queryFn: () => api.get<CharacterDto[]>("/characters"),
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
