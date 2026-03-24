import { create } from "zustand";

export type TaskType = "stems" | "pitch" | "align";

export interface QueueTask {
  id: string;
  songId: string;
  songTitle: string;
  type: TaskType;
  status: "pending" | "running";
  options?: { model?: string };
}

interface TaskQueueState {
  tasks: QueueTask[];
  enqueue: (songId: string, songTitle: string, type: TaskType, options?: { model?: string }) => void;
  markRunning: (taskId: string) => void;
  dequeue: (taskId: string) => void;
}

export const useTaskQueueStore = create<TaskQueueState>((set, get) => ({
  tasks: [],

  enqueue: (songId, songTitle, type, options) => {
    // Skip if already queued or running for this song+type
    if (get().tasks.some((t) => t.songId === songId && t.type === type)) return;
    set((s) => ({
      tasks: [
        ...s.tasks,
        { id: crypto.randomUUID(), songId, songTitle, type, status: "pending", options },
      ],
    }));
  },

  markRunning: (taskId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status: "running" } : t
      ),
    })),

  dequeue: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),
}));
