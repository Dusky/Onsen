import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type {
  AppendMessageRequest,
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

export function useScenes() {
  return useQuery({ queryKey: keys.scenes, queryFn: () => api.get<SceneDto[]>("/scenes") });
}

export function useScene(sceneId: string) {
  return useQuery({
    queryKey: keys.scene(sceneId),
    queryFn: () => api.get<SceneWithHistoryDto>(`/scenes/${sceneId}`),
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

/** Swipe, rewind, branch and checkpoint restore are all this one call (§2). */
export function useSetLeaf(sceneId: string) {
  return useSceneMutation(sceneId, (body: SetActiveLeafRequest) =>
    api.put<SceneWithHistoryDto>(`/scenes/${sceneId}/leaf`, body),
  );
}
