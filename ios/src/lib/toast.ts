import { create } from 'zustand'

export interface ToastMsg { id: number; text: string; action?: { label: string; run: () => void | Promise<void> }; tone?: 'error' }
interface State { toast: ToastMsg | null; show: (t: Omit<ToastMsg, 'id'>) => void; hide: () => void }

let n = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** One toast at a time; a new one replaces the old. With an action it stays 6 s, plain ones 3 s. */
export const useToast = create<State>((set) => ({
  toast: null,
  show: (t) => {
    clearTimeout(timer)
    const id = ++n
    set({ toast: { ...t, id } })
    timer = setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), t.action ? 6000 : 3000)
  },
  hide: () => { clearTimeout(timer); set({ toast: null }) },
}))
export const toast = (t: Omit<ToastMsg, 'id'>) => useToast.getState().show(t)
